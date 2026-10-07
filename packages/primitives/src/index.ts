export type ButtonState = 'default' | 'disabled' | 'loading' | 'restricted';
export type FieldState = 'default' | 'disabled' | 'readonly' | 'error';

export function buttonState(input: Readonly<{disabled?: boolean; loading?: boolean; restricted?: boolean}>): ButtonState {
  if (input.restricted) return 'restricted';
  if (input.loading) return 'loading';
  if (input.disabled) return 'disabled';
  return 'default';
}

export function fieldState(input: Readonly<{disabled?: boolean; readOnly?: boolean; invalid?: boolean}>): FieldState {
  if (input.disabled) return 'disabled';
  if (input.readOnly) return 'readonly';
  if (input.invalid) return 'error';
  return 'default';
}

export function isControlUnavailable(state: ButtonState): boolean {
  return state !== 'default';
}
