import React, { useState } from 'react';
import { Play, FolderSync, AlertTriangle, Layers } from 'lucide-react';
import { api } from '../../lib/api';
import { Project } from '../../types/project';
import {
  FtpConfig,
  FtpCommand,
  FtpSimResult,
} from '../../types/application';
import { ApplicationProtocolTimeline } from './ApplicationProtocolTimeline';
import { Packet } from '../../types/packet';

interface FtpStudioProps {
  project?: Project | null;
  onPacketSelect?: (packet: Packet | null) => void;
  selectedPacketId?: string | null;
}

export const FtpStudio: React.FC<FtpStudioProps> = ({
  project,
  onPacketSelect,
  selectedPacketId,
}) => {
  const [clientNode, setClientNode] = useState<string>('');
  const [serverNode, setServerNode] = useState<string>('ftp-server');
  const [username, setUsername] = useState<string>('anonymous');
  const [password, setPassword] = useState<string>('guest@example.com');
  const [command, setCommand] = useState<FtpCommand>('RETR');
  const [filename, setFilename] = useState<string>('research_paper.pdf');
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(4096);
  const [controlPort] = useState<number>(21);
  const [dataPort] = useState<number>(50000);
  const [seed] = useState<number>(42);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<FtpSimResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (project?.nodes && project.nodes.length >= 2) {
      setClientNode(project.nodes[0].id);
      setServerNode(project.nodes[1].id);
    }
  }, [project]);

  const runSimulation = async () => {
    if (!clientNode || !serverNode) {
      setErrorMsg('Add at least two devices to the topology before running a simulation.');
      return;
    }
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const config: FtpConfig = {
        client_node_id: clientNode,
        server_node_id: serverNode,
        username: username.trim(),
        password: password.trim() ? password.trim() : null,
        transfer_command: command,
        filename: filename.trim() ? filename.trim() : null,
        file_size_bytes: fileSizeBytes,
        control_port: controlPort,
        data_port: dataPort,
        seed,
      };

      const res = await api.simulateFtp(config);
      setResult(res);

      if (res.packets.length > 0) {
        onPacketSelect?.(res.packets[0]);
      }
    } catch (err) {
      // A failed run must not leave the previous successful result on screen.
      setResult(null);
      onPacketSelect?.(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const handleSelectPacketById = (pktId: string) => {
    const pkt = result?.packets.find((p) => p.id === pktId) || null;
    onPacketSelect?.(pkt);
  };

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
            <FolderSync className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">File Transfer Protocol (FTP) Studio</h3>
            <p className="text-xs text-slate-400">
              Two distinct logical TCP channels: Control (Port 21 command dialog) and Data (Port 50000+ payload transfer).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCommand('RETR');
              setFilename('research_paper.pdf');
              setFileSizeBytes(4096);
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
          >
            RETR (Download)
          </button>
          <button
            type="button"
            onClick={() => {
              setCommand('STOR');
              setFilename('telemetry_dump.bin');
              setFileSizeBytes(8192);
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
          >
            STOR (Upload)
          </button>
          <button
            type="button"
            onClick={() => {
              setCommand('LIST');
              setFilename('');
              setFileSizeBytes(512);
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
          >
            LIST (Directory)
          </button>
        </div>
      </div>

      {/* Config Form */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/40 p-3.5 rounded-xl border border-slate-800/80">
        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">FTP Client Node</label>
          <input aria-label="FTP Client Node"
            type="text"
            value={clientNode}
            onChange={(e) => setClientNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">FTP Server Node</label>
          <input aria-label="FTP Server Node"
            type="text"
            value={serverNode}
            onChange={(e) => setServerNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Username (USER)</label>
          <input aria-label="Username (USER)"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Password (PASS)</label>
          <input aria-label="Password (PASS)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Transfer Command</label>
          <select aria-label="Transfer Command"
            value={command}
            onChange={(e) => setCommand(e.target.value as FtpCommand)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-medium"
          >
            <option value="RETR">RETR (Retrieve / Download)</option>
            <option value="STOR">STOR (Store / Upload)</option>
            <option value="LIST">LIST (List Directory)</option>
          </select>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Target Filename</label>
          <input aria-label="Target Filename"
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Payload Size (Bytes)</label>
          <input aria-label="Payload Size (Bytes)"
            type="number"
            value={fileSizeBytes}
            onChange={(e) => setFileSizeBytes(Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={runSimulation}
            disabled={isRunning}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-amber-700 hover:bg-amber-800 text-white font-medium text-xs rounded shadow transition-colors disabled:bg-slate-700 disabled:text-slate-300"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isRunning ? 'Running FTP Flow...' : 'Simulate Dual-Channel FTP'}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-950/60 border border-rose-800 text-rose-300 text-xs rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Results Display */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Dual Channel Architecture Card */}
          <div className="space-y-3 lg:col-span-1">
            <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Dual-Channel Architecture
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                  {result.state.toUpperCase()}
                </span>
              </div>

              {/* Channel 1: Control */}
              <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800/80 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-amber-400">
                  <span>1. Control Channel</span>
                  <span className="font-mono text-[10px] text-slate-400">Port 21</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Session ID: <span className="text-slate-200">{result.control_session_id}</span>
                </div>
                <div className="text-[10px] text-slate-500">
                  Transfers commands: USER, PASS, {result.config.transfer_command}, QUIT and receives status codes (220, 331, 230, 221).
                </div>
              </div>

              {/* Channel 2: Data */}
              <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800/80 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-cyan-400">
                  <span>2. Data Channel</span>
                  <span className="font-mono text-[10px] text-slate-400">Port {result.config.data_port}</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Session ID: <span className="text-slate-200">{result.data_session_id}</span>
                </div>
                <div className="text-[10px] text-slate-500">
                  Separate TCP connection dedicated exclusively to file payload transmission ({result.config.file_size_bytes} bytes).
                </div>
              </div>

              {/* Performance Metrics */}
              <div className="pt-2 border-t border-slate-800/70 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 block">Total Duration</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.metrics.transaction_duration_us.toLocaleString()} µs
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Total Packets</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.packets.length} TCP Segments
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Control Bytes</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.metrics.payload_bytes_sent} B
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Data Transferred</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.metrics.payload_bytes_received} B
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Transaction Timeline */}
          <div className="lg:col-span-2">
            <ApplicationProtocolTimeline
              events={result.events}
              packets={result.packets}
              selectedPacketId={selectedPacketId}
              onSelectPacket={handleSelectPacketById}
            />
          </div>
        </div>
      )}
    </div>
  );
};
