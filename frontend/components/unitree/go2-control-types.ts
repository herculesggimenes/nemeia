export type JoystickValue = {
  x: number;
  y: number;
};

export type ControllerState = {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  keys: number;
};

export const EMPTY_CONTROLLER_STATE: ControllerState = { lx: 0, ly: 0, rx: 0, ry: 0, keys: 0 };
