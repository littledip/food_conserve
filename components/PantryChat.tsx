import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT_SIZE } from '../constants/theme';
import type { PantryChatMessage } from '../services/pantryChat';
import type { WasteMethod } from '../types/grocery';
import {
  runPantryChatTurn,
  applyConfirmedAction,
  discardPendingAction,
  isAbortError,
  type PendingConfirmation,
} from '../services/pantryChatExecutor';

// A hung or runaway backend (seen in practice: an unbounded local-model
// generation) would otherwise strand the user on a spinner forever. 180s
// comfortably covers even a full max_tokens generation on a slow local model
// (e.g. ~100s for 4096 tokens at ~40 tok/s) while still being a real backstop
// against a genuine hang; the in-UI Stop button covers "I don't want to wait
// that long" for impatient taps on either backend.
const CHAT_TURN_TIMEOUT_MS = 180000;

// Global chat entry point: a FAB reachable from any tab, mounted once in
// app/_layout.tsx so its conversation state survives switching tabs. Modal's
// `visible` prop only hides/shows the native overlay — this component (and
// its state) stays mounted underneath regardless.

const genId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type DisplayMessage =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'system-note'; text: string }
  | { id: string; kind: 'error'; text: string }
  | {
      id: string;
      kind: 'confirm-chip';
      toolUseId: string;
      toolName: PendingConfirmation['toolName'];
      itemId: string;
      itemName: string;
      // Only meaningful when toolName is 'dispose_item_wasted'. Mutable —
      // the chip lets the user change it before tapping Confirm.
      wasteMethod?: WasteMethod;
      status: 'pending' | 'confirmed' | 'canceled';
    };

const WASTE_METHOD_OPTIONS: { value: WasteMethod; label: string }[] = [
  { value: 'trash', label: 'Trash' },
  { value: 'compost', label: 'Compost' },
  { value: 'drain', label: 'Drain' },
];

const CONFIRM_CHIP_COPY: Record<PendingConfirmation['toolName'], { question: string; confirmedNote: string }> = {
  dispose_item_wasted: {
    question: 'Mark as wasted?',
    confirmedNote: 'marked as wasted',
  },
  remove_item: {
    question: 'Delete this item?',
    confirmedNote: 'deleted',
  },
};

function ConfirmChip({
  msg,
  onConfirm,
  onCancel,
  onSelectMethod,
}: {
  msg: Extract<DisplayMessage, { kind: 'confirm-chip' }>;
  onConfirm: () => void;
  onCancel: () => void;
  onSelectMethod: (method: WasteMethod) => void;
}) {
  const copy = CONFIRM_CHIP_COPY[msg.toolName];
  const showMethodPicker = msg.toolName === 'dispose_item_wasted' && msg.status === 'pending';
  return (
    <View style={styles.confirmChip}>
      <Text style={styles.confirmChipItem}>{msg.itemName}</Text>
      <Text style={styles.confirmChipQuestion}>{copy.question}</Text>
      {showMethodPicker && (
        <View style={styles.methodRow}>
          {WASTE_METHOD_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.methodChip, msg.wasteMethod === opt.value && styles.methodChipActive]}
              onPress={() => onSelectMethod(opt.value)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.methodChipText,
                  msg.wasteMethod === opt.value && styles.methodChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {msg.status === 'pending' ? (
        <View style={styles.confirmChipActions}>
          <TouchableOpacity style={styles.confirmChipCancel} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.confirmChipCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmChipConfirm} onPress={onConfirm} activeOpacity={0.7}>
            <Text style={styles.confirmChipConfirmText}>Confirm</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.confirmChipResolved}>
          {msg.status === 'confirmed' ? `Confirmed — ${copy.confirmedNote}.` : 'Canceled.'}
        </Text>
      )}
    </View>
  );
}

function MessageBubble({ msg }: { msg: Extract<DisplayMessage, { kind: 'user' | 'assistant' | 'system-note' | 'error' }> }) {
  if (msg.kind === 'user') {
    return (
      <View style={[styles.bubble, styles.userBubble]}>
        <Text style={styles.userBubbleText}>{msg.text}</Text>
      </View>
    );
  }
  if (msg.kind === 'assistant') {
    return (
      <View style={[styles.bubble, styles.assistantBubble]}>
        <Text style={styles.assistantBubbleText}>{msg.text}</Text>
      </View>
    );
  }
  if (msg.kind === 'error') {
    return (
      <View style={[styles.bubble, styles.errorBubble]}>
        <Text style={styles.errorBubbleText}>{msg.text}</Text>
      </View>
    );
  }
  return (
    <View style={styles.systemNoteRow}>
      <Text style={styles.systemNoteText}>{msg.text}</Text>
    </View>
  );
}

export function PantryChatFab() {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="chatbubble-ellipses" size={24} color="#EAF3DE" />
      </TouchableOpacity>
      <PantryChatSheet visible={visible} onClose={() => setVisible(false)} />
    </>
  );
}

function PantryChatSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  // Model-facing conversation history — kept out of React state since it must
  // never include UI-only bubbles (confirm/cancel notes, errors) and doesn't
  // need to trigger re-renders.
  const transcriptRef = useRef<PantryChatMessage[]>([]);
  const streamingTextRef = useRef('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  const appendMessage = (msg: DisplayMessage) => {
    setMessages((prev) => [...prev, msg]);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const updateChip = (id: string, status: 'confirmed' | 'canceled') => {
    setMessages((prev) => prev.map((m) => (m.id === id && m.kind === 'confirm-chip' ? { ...m, status } : m)));
  };

  const updateChipMethod = (id: string, wasteMethod: WasteMethod) => {
    setMessages((prev) => prev.map((m) => (m.id === id && m.kind === 'confirm-chip' ? { ...m, wasteMethod } : m)));
  };

  async function handleSend() {
    const text = inputText.trim();
    if (!text || isThinking) return;
    setInputText('');
    appendMessage({ id: genId(), kind: 'user', text });
    setIsThinking(true);
    streamingTextRef.current = '';
    setStreamingText('');

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), CHAT_TURN_TIMEOUT_MS);

    try {
      const updatedTranscript = await runPantryChatTurn(text, transcriptRef.current, {
        signal: controller.signal,
        onTextDelta: (delta) => {
          streamingTextRef.current += delta;
          setStreamingText(streamingTextRef.current);
        },
        onAssistantMessage: (fullText) => {
          appendMessage({ id: genId(), kind: 'assistant', text: fullText });
          streamingTextRef.current = '';
          setStreamingText('');
        },
        onPendingConfirmation: (pending) => {
          appendMessage({
            id: pending.toolUseId,
            kind: 'confirm-chip',
            toolUseId: pending.toolUseId,
            toolName: pending.toolName,
            itemId: pending.itemId,
            itemName: pending.itemName,
            wasteMethod: pending.wasteMethod,
            status: 'pending',
          });
        },
      });
      transcriptRef.current = updatedTranscript;
    } catch (e) {
      // expo/fetch's abort error is a plain Error with no distinguishing
      // `.name` (unlike a standard DOMException AbortError), so checking
      // our own controller's signal is the reliable way to know "this
      // rejection is because WE canceled it" regardless of what shape the
      // underlying fetch implementation throws.
      if (controller.signal.aborted || isAbortError(e)) {
        appendMessage({ id: genId(), kind: 'system-note', text: 'Stopped.' });
      } else {
        appendMessage({
          id: genId(),
          kind: 'error',
          text: e instanceof Error ? e.message : 'Something went wrong reaching the assistant.',
        });
      }
    } finally {
      clearTimeout(timeout);
      abortControllerRef.current = null;
      streamingTextRef.current = '';
      setStreamingText('');
      setIsThinking(false);
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  function handleConfirm(msg: Extract<DisplayMessage, { kind: 'confirm-chip' }>) {
    applyConfirmedAction({
      toolUseId: msg.toolUseId,
      toolName: msg.toolName,
      itemId: msg.itemId,
      itemName: msg.itemName,
      wasteMethod: msg.wasteMethod,
    });
    updateChip(msg.id, 'confirmed');
  }

  function handleCancel(msg: Extract<DisplayMessage, { kind: 'confirm-chip' }>) {
    discardPendingAction({
      toolUseId: msg.toolUseId,
      toolName: msg.toolName,
      itemId: msg.itemId,
      itemName: msg.itemName,
    });
    updateChip(msg.id, 'canceled');
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose} />
      <KeyboardAvoidingView
        style={styles.sheetWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.sm }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Pantry Assistant</Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.messageList}
            contentContainerStyle={styles.messageListContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {messages.length === 0 && (
              <Text style={styles.emptyHint}>
                Try "I used half the milk", "add a dozen eggs", or "what's expiring this week?"
              </Text>
            )}
            {messages.map((msg) =>
              msg.kind === 'confirm-chip' ? (
                <ConfirmChip
                  key={msg.id}
                  msg={msg}
                  onConfirm={() => handleConfirm(msg)}
                  onCancel={() => handleCancel(msg)}
                  onSelectMethod={(method) => updateChipMethod(msg.id, method)}
                />
              ) : (
                <MessageBubble key={msg.id} msg={msg} />
              ),
            )}
            {isThinking && streamingText.length > 0 && (
              <View style={[styles.bubble, styles.assistantBubble]}>
                <Text style={styles.assistantBubbleText}>{streamingText}</Text>
              </View>
            )}
            {isThinking && streamingText.length === 0 && (
              <View style={[styles.bubble, styles.assistantBubble, styles.thinkingBubble]}>
                <ActivityIndicator size="small" color={COLORS.primaryGreen} />
              </View>
            )}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Ask or tell the assistant..."
              placeholderTextColor={COLORS.textSecondary}
              multiline
              editable={!isThinking}
            />
            {isThinking ? (
              <TouchableOpacity style={styles.stopButton} onPress={handleStop} activeOpacity={0.7}>
                <Ionicons name="stop" size={16} color={COLORS.redDark} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
                onPress={handleSend}
                activeOpacity={0.7}
                disabled={!inputText.trim()}
              >
                <Ionicons name="arrow-up" size={18} color="#EAF3DE" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 90,
    right: SPACING.md,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primaryGreen,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetWrapper: {
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.cardWhite,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '75%',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: SPACING.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.subtleBorder,
  },
  sheetTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '500',
    color: COLORS.darkGreen,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  emptyHint: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.lg,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 12,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primaryGreen,
  },
  userBubbleText: {
    color: '#EAF3DE',
    fontSize: FONT_SIZE.md,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.statCardBg,
  },
  assistantBubbleText: {
    color: COLORS.darkGreen,
    fontSize: FONT_SIZE.md,
  },
  thinkingBubble: {
    paddingVertical: SPACING.sm + 2,
  },
  errorBubble: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.alertCardBg,
    borderWidth: 0.5,
    borderColor: COLORS.alertBorder,
  },
  errorBubbleText: {
    color: COLORS.redDark,
    fontSize: FONT_SIZE.sm,
  },
  systemNoteRow: {
    alignItems: 'center',
  },
  systemNoteText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  confirmChip: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.alertCardBg,
    borderWidth: 0.5,
    borderColor: COLORS.alertBorder,
    borderRadius: 10,
    padding: SPACING.sm,
  },
  confirmChipItem: {
    fontSize: FONT_SIZE.md,
    fontWeight: '500',
    color: COLORS.darkGreen,
  },
  confirmChipQuestion: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.redText,
    marginTop: 2,
    marginBottom: SPACING.sm,
  },
  methodRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  methodChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.alertBorder,
    backgroundColor: COLORS.cardWhite,
  },
  methodChipActive: {
    backgroundColor: COLORS.redDark,
    borderColor: COLORS.redDark,
  },
  methodChipText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  methodChipTextActive: {
    color: '#FCEBEB',
  },
  confirmChipActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  confirmChipCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.xs + 2,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    backgroundColor: COLORS.cardWhite,
  },
  confirmChipCancelText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  confirmChipConfirm: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.xs + 2,
    borderRadius: 8,
    backgroundColor: COLORS.redDark,
  },
  confirmChipConfirmText: {
    fontSize: FONT_SIZE.sm,
    color: '#FCEBEB',
    fontWeight: '500',
  },
  confirmChipResolved: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.subtleBorder,
  },
  textInput: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 18,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZE.md,
    color: COLORS.darkGreen,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.borderColor,
  },
  stopButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.alertCardBg,
    borderWidth: 0.5,
    borderColor: COLORS.alertBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
