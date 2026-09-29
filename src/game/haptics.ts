import type { InputManager } from '@iwsdk/core';

/** Controller pulse through raw WebXR (IWSDK has no haptics wrapper). Fire-and-forget. */
export function pulse(input: InputManager, hand: 'left' | 'right' | undefined, intensity: number, ms: number): void {
  if (!hand) return;
  const actuator = input.xr.gamepads[hand]?.gamepad.hapticActuators?.[0];
  if (actuator) void actuator.pulse(intensity, ms).catch(() => {});
}
