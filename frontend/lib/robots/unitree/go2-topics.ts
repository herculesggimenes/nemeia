export const GO2_PORT = 9991;
export const GO2_OLD_OFFER_PORT = 8081;

export const GO2_TOPIC = {
  SPORT_MOD: "rt/api/sport/request",
  WIRELESS_CONTROLLER: "rt/wirelesscontroller",
  LIDAR_SWITCH: "rt/utlidar/switch",
  LIDAR_ARRAY: "rt/utlidar/voxel_map_compressed",
  LIDAR_STATE: "rt/utlidar/lidar_state",
  ROBOT_ODOM: "rt/utlidar/robot_pose",
  LOW_STATE: "rt/lf/lowstate",
  SPORT_MODE_STATE: "rt/lf/sportmodestate"
} as const;

export const GO2_SPORT_CMD = {
  Damp: 1001,
  BalanceStand: 1002,
  StopMove: 1003
} as const;

export const GO2_DATA_CHANNEL_TYPE = {
  VALIDATION: "validation",
  SUBSCRIBE: "subscribe",
  MSG: "msg",
  REQUEST: "req",
  VID: "vid",
  AUD: "aud",
  ERR: "err",
  HEARTBEAT: "heartbeat",
  RTC_INNER_REQ: "rtc_inner_req"
} as const;
