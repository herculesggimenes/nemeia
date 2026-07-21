"use client";

import { type ElementType, useEffect, useState } from "react";
import { Cable, Gamepad2, Plug, Save, Shield, Unplug, Video, Volume2, Waves } from "lucide-react";
import { initializeRobotRuntime, useRobotRuntime, type RobotConnectionMode } from "../../lib/robots/standard/robot-runtime";
import { normalizeGo2Ip } from "../../lib/robots/unitree/go2-config";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

function PowerSwitch({
  checked,
  description,
  disabled,
  icon: Icon,
  id,
  label,
  onCheckedChange,
  pending
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  icon: ElementType;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  pending?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-surface-3 bg-surface-2 p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-8 place-items-center rounded-md bg-surface-3 text-primary">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <Label htmlFor={id}>{label}</Label>
          <p className="mt-1 text-xs text-muted">{pending ? "Applying..." : description}</p>
        </div>
      </div>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        disabled={disabled || pending}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function Go2ConnectionConfigPanel() {
  const robotRuntime = useRobotRuntime();
  const {
    cameraEnabled,
    config,
    connectionState,
    disconnect,
    enterDampState,
    enterStandState,
    lastError,
    lastEvent,
    lidarEnabled,
    obstacleAvoidanceEnabled,
    runtimePending,
    setCameraEnabled,
    setConfig,
    setLidarEnabled,
    setObstacleAvoidanceEnabled,
    setSpeakerEnabled,
    speakerEnabled,
    stopMotion
  } = robotRuntime;
  const [draftAutoReconnect, setDraftAutoReconnect] = useState(config.autoReconnect);
  const [draftIp, setDraftIp] = useState(config.ip);
  const [draftMode, setDraftMode] = useState<RobotConnectionMode>(config.mode);

  useEffect(() => {
    initializeRobotRuntime();
  }, []);

  useEffect(() => {
    setDraftAutoReconnect(config.autoReconnect);
    setDraftIp(config.ip);
    setDraftMode(config.mode);
  }, [config.autoReconnect, config.ip, config.mode]);

  const draftConfig = () => ({
    autoReconnect: draftAutoReconnect,
    robotId: config.robotId,
    ip: normalizeGo2Ip(draftIp),
    mode: draftMode
  });

  const saveConfig = () => {
    setConfig(draftConfig());
  };
  const runtimeControlsDisabled = connectionState !== "connected";

  return (
    <div className="min-h-0 overflow-auto p-4">
      <Card>
        <div className="border-b border-surface-3 p-4">
          <h2 className="text-base font-bold text-foreground">Robot local connection</h2>
          <p className="mt-1 text-xs text-muted">Robot connection settings live with the standard driver component.</p>
        </div>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="go2-ip">Robot IP</Label>
            <Input
              id="go2-ip"
              value={draftIp}
              onChange={(event) => setDraftIp(event.target.value)}
              placeholder="10.0.0.78"
            />
            <p className="text-xs text-muted">
              Detected on this network: 10.0.0.78. Use the access-point address only when connected directly to the robot network.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Connection mode</Label>
            <Select value={draftMode} onValueChange={(value) => setDraftMode(value as RobotConnectionMode)}>
              <SelectTrigger aria-label="Robot connection mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AP">Access Point</SelectItem>
                <SelectItem value="STA-L">Local Network</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-surface-3 bg-surface-2 p-3">
            <div className="grid gap-1">
              <Label htmlFor="go2-auto-reconnect">Auto reconnect</Label>
              <p className="text-xs text-muted">Retry with exponential backoff when the robot connection drops.</p>
            </div>
            <Switch
              id="go2-auto-reconnect"
              aria-label="Auto reconnect"
              checked={draftAutoReconnect}
              onCheckedChange={setDraftAutoReconnect}
            />
          </div>

          <div className="grid gap-3">
            <div className="grid gap-1">
              <h3 className="text-sm font-bold text-foreground">Power management</h3>
              <p className="text-xs text-muted">Disable streams and high-activity behaviors while developing.</p>
            </div>
            <PowerSwitch
              checked={cameraEnabled}
              description={runtimeControlsDisabled ? "Connect the robot before changing camera power." : "Sends the stream command to the connected robot."}
              disabled={runtimeControlsDisabled}
              icon={Video}
              id="go2-camera-power"
              label="Front camera stream"
              onCheckedChange={(checked) => {
                void setCameraEnabled(checked);
              }}
              pending={runtimePending.camera}
            />
            <PowerSwitch
              checked={lidarEnabled}
              description={runtimeControlsDisabled ? "Connect the robot before changing LiDAR power." : "Sends the LiDAR switch command to the connected robot."}
              disabled={runtimeControlsDisabled}
              icon={Waves}
              id="go2-lidar-power"
              label="LiDAR / SLAM stream"
              onCheckedChange={(checked) => {
                void setLidarEnabled(checked);
              }}
              pending={runtimePending.lidar}
            />
            <PowerSwitch
              checked={speakerEnabled}
              description={runtimeControlsDisabled ? "Connect the robot before changing speaker output." : "Sends the audio stream command to the connected robot."}
              disabled={runtimeControlsDisabled}
              icon={Volume2}
              id="go2-speaker-power"
              label="Speaker output stream"
              onCheckedChange={(checked) => {
                void setSpeakerEnabled(checked);
              }}
              pending={runtimePending.speaker}
            />
            <PowerSwitch
              checked={obstacleAvoidanceEnabled}
              description={runtimeControlsDisabled ? "Connect the robot before changing obstacle avoidance." : "Sends the obstacle avoidance request to the connected robot."}
              disabled={runtimeControlsDisabled}
              icon={Shield}
              id="go2-obstacle-avoidance"
              label="Obstacle avoidance"
              onCheckedChange={(checked) => {
                void setObstacleAvoidanceEnabled(checked);
              }}
              pending={runtimePending.obstacleAvoidance}
            />
          </div>

          <div className="grid gap-3 rounded-md border border-surface-3 bg-surface-2 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-8 place-items-center rounded-md bg-surface-3 text-primary">
                <Gamepad2 size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-foreground">Motors</h3>
                <p className="mt-1 text-xs text-muted">Use behavior commands for low-activity motor states.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-7 px-2 text-xs"
                disabled={runtimeControlsDisabled}
                variant="outline"
                onClick={stopMotion}
              >
                Stop movement
              </Button>
              <Button
                className="h-7 px-2 text-xs"
                disabled={runtimeControlsDisabled}
                variant="outline"
                onClick={enterDampState}
              >
                Damp motors
              </Button>
              <Button
                className="h-7 px-2 text-xs"
                disabled={runtimeControlsDisabled}
                variant="outline"
                onClick={enterStandState}
              >
                Stand
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button className="gap-2" variant="outline" onClick={saveConfig}>
              <Save size={15} />
              Save
            </Button>
            <Button
              className="gap-2"
              variant="outline"
              onClick={() => {
                void robotRuntime.testConnection(draftConfig());
              }}
            >
              <Cable size={15} />
              Test
            </Button>
            <Button
              className="gap-2"
              onClick={() => {
                void robotRuntime.connectWithConfig(draftConfig());
              }}
            >
              <Plug size={15} />
              Connect
            </Button>
            <Button className="gap-2" variant="ghost" onClick={disconnect}>
              <Unplug size={15} />
              Disconnect
            </Button>
          </div>

          <div className="rounded-md border border-surface-3 bg-surface-2 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">State</span>
              <strong className="text-foreground">{connectionState}</strong>
            </div>
            {lastEvent ? <p className="mt-2 text-muted">{lastEvent}</p> : null}
            {lastError ? <p className="mt-2 text-danger">{lastError}</p> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
