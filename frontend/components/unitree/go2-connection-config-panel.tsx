"use client";

import { useEffect, useState } from "react";
import { Cable, Plug, Save, Unplug } from "lucide-react";
import { normalizeGo2Ip } from "../../lib/robots/unitree/go2-config";
import { initializeGo2Store, useGo2Store } from "../../lib/robots/unitree/go2-store";
import type { Go2Mode } from "../../lib/robots/unitree/go2-types";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export function Go2ConnectionConfigPanel() {
  const config = useGo2Store((state) => state.config);
  const connectionState = useGo2Store((state) => state.connectionState);
  const lastError = useGo2Store((state) => state.lastError);
  const lastEvent = useGo2Store((state) => state.lastEvent);
  const setConfig = useGo2Store((state) => state.setConfig);
  const testConnection = useGo2Store((state) => state.testConnection);
  const connect = useGo2Store((state) => state.connect);
  const disconnect = useGo2Store((state) => state.disconnect);
  const [draftIp, setDraftIp] = useState(config.ip);
  const [draftMode, setDraftMode] = useState<Go2Mode>(config.mode);

  useEffect(() => {
    initializeGo2Store();
  }, []);

  useEffect(() => {
    setDraftIp(config.ip);
    setDraftMode(config.mode);
  }, [config.ip, config.mode]);

  const draftConfig = () => ({
    robotId: config.robotId,
    ip: normalizeGo2Ip(draftIp),
    mode: draftMode
  });

  const saveConfig = () => {
    setConfig(draftConfig());
  };

  return (
    <div className="min-h-0 overflow-auto p-4">
      <Card>
        <div className="border-b border-surface-3 p-4">
          <h2 className="text-base font-bold text-foreground">Go2 local connection</h2>
          <p className="mt-1 text-xs text-muted">Robot connection settings live with the Go2 component.</p>
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
              Detected on this network: 10.0.0.78. Use 192.168.12.1 only when connected to the Go2 access point.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Connection mode</Label>
            <Select value={draftMode} onValueChange={(value) => setDraftMode(value as Go2Mode)}>
              <SelectTrigger aria-label="Go2 connection mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AP">Access Point</SelectItem>
                <SelectItem value="STA-L">Local Network</SelectItem>
              </SelectContent>
            </Select>
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
                void testConnection(draftConfig());
              }}
            >
              <Cable size={15} />
              Test
            </Button>
            <Button
              className="gap-2"
              onClick={() => {
                void connect(draftConfig());
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
