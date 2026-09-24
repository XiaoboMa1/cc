import { describe, expect, it } from 'vitest';
import {
  captureKindForPlatform,
  defaultHotkeysForPlatform,
  whisperExecutionProvidersForPlatform,
} from '../shared/platform';

describe('platform defaults', () => {
  it('uses familiar Command shortcuts on macOS without changing Windows defaults', () => {
    expect(defaultHotkeysForPlatform('darwin')).toEqual({
      toggle: 'Command+B',
      shot: 'Command+H',
      shotUndo: 'Command+L',
      shotClear: 'Command+R',
    });
    expect(defaultHotkeysForPlatform('win32')).toEqual({
      toggle: 'Control+B',
      shot: 'Control+H',
      shotUndo: 'Control+L',
      shotClear: 'Control+R',
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
