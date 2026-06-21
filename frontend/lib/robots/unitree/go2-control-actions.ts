import { GO2_SPORT_CMD } from "./go2-topics";

const DATA_TRUE = "{\"data\":true}";

export type Go2SportAction = {
  apiId: number;
  label: string;
  parameter?: string;
  danger?: boolean;
  kind?: "mode";
};

export const GO2_PRIMARY_ACTIONS: Go2SportAction[] = [
  { apiId: GO2_SPORT_CMD.RecoveryStand, label: "Stand" },
  { apiId: GO2_SPORT_CMD.Damp, label: "Damp", danger: true },
  { apiId: GO2_SPORT_CMD.StopMove, label: "Stop", danger: true },
  { apiId: GO2_SPORT_CMD.FreeAvoid, label: "Obstacle Avoid On", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.FreeAvoid, label: "Obstacle Avoid Off" }
];

export const GO2_MODE_ACTIONS: Go2SportAction[] = [
  { apiId: GO2_SPORT_CMD.FreeWalk, label: "Free Walk", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.Pose, label: "Pose", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.SwitchGait, label: "Normal Walk", parameter: "{\"data\":0}", kind: "mode" },
  { apiId: GO2_SPORT_CMD.SwitchGait, label: "Run", parameter: "{\"data\":1}", kind: "mode" },
  { apiId: GO2_SPORT_CMD.WalkStair, label: "Walk Stair", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.StaticWalk, label: "Static Walk", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.EconomicGait, label: "Endurance", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.LeadFollow, label: "Leash", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.HandStand, label: "Hand Stand", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.FreeBound, label: "Bound", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.FreeJump, label: "Jump", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.CrossStep, label: "Cross Step", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.BackStand, label: "Rear Stand", parameter: DATA_TRUE, kind: "mode" },
  { apiId: GO2_SPORT_CMD.RageMode, label: "Rage", parameter: DATA_TRUE, kind: "mode" }
];

export const GO2_TRICK_ACTIONS: Go2SportAction[] = [
  { apiId: GO2_SPORT_CMD.Wallow, label: "Roll Over" },
  { apiId: GO2_SPORT_CMD.Stretch, label: "Stretch" },
  { apiId: GO2_SPORT_CMD.Hello, label: "Shake Hand" },
  { apiId: GO2_SPORT_CMD.FingerHeart, label: "Heart" },
  { apiId: GO2_SPORT_CMD.FrontPounce, label: "Pounce" },
  { apiId: GO2_SPORT_CMD.FrontJump, label: "Jump Fwd" },
  { apiId: GO2_SPORT_CMD.Scrape, label: "Greet" },
  { apiId: GO2_SPORT_CMD.Dance1, label: "Dance 1" },
  { apiId: GO2_SPORT_CMD.Dance2, label: "Dance 2" },
  { apiId: GO2_SPORT_CMD.FrontFlip, label: "Front Flip", parameter: DATA_TRUE, danger: true },
  { apiId: GO2_SPORT_CMD.BackFlip, label: "Back Flip", parameter: DATA_TRUE, danger: true },
  { apiId: GO2_SPORT_CMD.LeftFlip, label: "Left Flip", parameter: DATA_TRUE, danger: true },
  { apiId: GO2_SPORT_CMD.Sit, label: "Sit Down" },
  { apiId: GO2_SPORT_CMD.StandDown, label: "Crouch" },
  { apiId: GO2_SPORT_CMD.StandUp, label: "Lock On" }
];
