import { expect, it } from 'vitest';
import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import shared from './wire/audio-floor.json';

it('A11: the meter notch and native readiness share one audio floor', () => {
  expect(AUDIO_FLOOR).toBe(shared.floor);
});
