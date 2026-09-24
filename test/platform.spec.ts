import { describe, expect, it } from 'vitest';
import {
  captureKindForPlatform,
  defaultHotkeysForPlatform,
  whisperExecutionProvidersForPlatform,
} from '../shared/platform';

describe('platform defaults', () => {
  it('uses familiar Command shortcuts on macOS without changing Windows defaults', () => {
    expect(defaultHotkeysForPlatform('darwin')).toEqual({
      hotkeyToggle: 'Command+B',
      hotkeyShot: 'Command+H',
      hotkeyShotUndo: 'Command+L',
      hotkeyShotClear: 'Command+R',
      hotkeyAnswer: 'Command+Enter',
      hotkeyFreeAsk: 'Command+M',
      hotkeyCapture: 'Command+S',
      hotkeyClearAnswers: 'Command+D',
      hotkeyClearTranscript: 'Command+T',
      hotkeyMove: 'Command',
    });
    expect(defaultHotkeysForPlatform('win32')).toEqual({
      hotkeyToggle: 'Control+B',
      hotkeyShot: 'Control+H',
      hotkeyShotUndo: 'Control+L',
      hotkeyShotClear: 'Control+R',
      hotkeyAnswer: 'Control+Enter',
      hotkeyFreeAsk: 'Control+M',
      hotkeyCapture: 'Control+S',
      hotkeyClearAnswers: 'Control+D',
      hotkeyClearTranscript: 'Control+T',
      hotkeyMove: 'Control',
    });
  });

  it('uses Electron loopback only on Windows', () => {
    expect(captureKindForPlatform('win32')).toBe('loopback');
    expect(captureKindForPlatform('darwin')).toBe('input');
    expect(captureKindForPlatform('linux')).toBe('input');
  });

  it('never attempts the Windows DirectML provider on macOS', () => {
    expect(whisperExecutionProvidersForPlatform('win32')).toEqual(['dml', 'cpu']);
    expect(whisperExecutionProvidersForPlatform('darwin')).toEqual(['cpu']);
  });
});
