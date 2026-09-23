import React, { useState } from 'react';
import { Play, Gauge, AlertTriangle, Cpu } from 'lucide-react';
import { api } from '../../lib/tauri';
import { Project } from '../../types/project';
import {
  SnmpConfig,
  MibObject,
  SnmpSimResult,
} from '../../types/application';
import { ApplicationProtocolTimeline } from './ApplicationProtocolTimeline';
import { Packet } from '../../types/packet';

interface SnmpStudioProps {
  project?: Project | null;
  onPacketSelect?: (packet: Packet | null) => void;
  selectedPacketId?: string | null;
}

const DEFAULT_MIB_OBJECTS: MibObject[] = [
  {
    oid: '1.3.6.1.2.1.1.1.0',
    name: 'sysDescr.0',
    syntax: 'DisplayString',
    value: 'NetSim CoreOS Router v2.4 (x86_64, Educational Edition)',
    description: 'A textual description of the network entity.',
  },
  {
    oid: '1.3.6.1.2.1.1.3.0',
    name: 'sysUpTime.0',
    syntax: 'TimeTicks',
    value: '1248900 (3 hours, 28 minutes, 9 seconds)',
    description: 'The time since the network management portion was initialized.',
  },
  {
    oid: '1.3.6.1.2.1.1.5.0',
    name: 'sysName.0',
    syntax: 'DisplayString',
    value: 'Gateway-R1.internal',
    description: 'An administratively-assigned name for this managed node.',
  },
  {
    oid: '1.3.6.1.2.1.2.2.1.10.1',
    name: 'ifInOctets.1',
    syntax: 'Counter32',
    value: '849203948',
    description: 'The total number of octets received on interface eth0.',
  },
  {
    oid: '1.3.6.1.2.1.2.2.1.16.1',
    name: 'ifOutOctets.1',
    syntax: 'Counter32',
    value: '729482109',
    description: 'The total number of octets transmitted out of interface eth0.',
  },
];

export const SnmpStudio: React.FC<SnmpStudioProps> = ({
  project,
  onPacketSelect,
  selectedPacketId,
}) => {
  const [managerNode, setManagerNode] = useState<string>('nms-manager');
  const [agentNode, setAgentNode] = useState<string>('router-core');
  const [community, setCommunity] = useState<string>('public');
  const [requestedOid, setRequestedOid] = useState<string>('1.3.6.1.2.1.1.1.0');
  const [port, setPort] = useState<number>(161);
  const [seed] = useState<number>(42);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<SnmpSimResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (project?.nodes && project.nodes.length >= 2) {
      setManagerNode(project.nodes[0].id);
      setAgentNode(project.nodes[1].id);
    }
  }, [project]);

  const runSimulation = async () => {
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const config: SnmpConfig = {
        manager_node_id: managerNode,
        agent_node_id: agentNode,
        community: community.trim(),
        requested_oid: requestedOid.trim(),
        port,
        seed,
      };

      const res = await api.simulateSnmp(config);
      setResult(res);

      if (res.packets.length > 0) {
        onPacketSelect?.(res.packets[0]);
      }
    } catch (err) {
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
          <div className="p-2 bg-teal-500/10 rounded-lg text-teal-400">
            <Gauge className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Simple Network Management Protocol (SNMP) Studio</h3>
            <p className="text-xs text-slate-400">
              Network management station (NMS) telemetry polling over UDP port 161 with MIB-2 tree resolution.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {DEFAULT_MIB_OBJECTS.slice(0, 3).map((obj) => (
            <button
              key={obj.name}
              type="button"
              onClick={() => setRequestedOid(obj.oid)}
              className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-colors ${
                requestedOid === obj.oid
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {obj.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRequestedOid('1.3.6.1.2.1.99.99.0')}
            className={`px-2 py-1 text-[11px] font-medium rounded-lg border transition-colors ${
              requestedOid === '1.3.6.1.2.1.99.99.0'
                ? 'bg-rose-900 text-rose-100 border-rose-600'
                : 'bg-rose-950/60 text-rose-300 hover:bg-rose-900/60 border-rose-800/60'
            }`}
          >
            Unknown OID
          </button>
        </div>
      </div>

      {/* Config Form */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/40 p-3.5 rounded-xl border border-slate-800/80">
        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">SNMP Manager (NMS)</label>
          <input
            type="text"
            value={managerNode}
            onChange={(e) => setManagerNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Managed Agent Node</label>
          <input
            type="text"
            value={agentNode}
            onChange={(e) => setAgentNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Community String</label>
          <input
            type="text"
            value={community}
            onChange={(e) => setCommunity(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">UDP Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div className="md:col-span-3">
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Target Object Identifier (OID)</label>
          <input
            type="text"
            value={requestedOid}
            onChange={(e) => setRequestedOid(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={runSimulation}
            disabled={isRunning}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-teal-600 hover:bg-teal-500 text-white font-medium text-xs rounded shadow transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isRunning ? 'Querying MIB...' : 'Send GetRequest (UDP)'}
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
          {/* MIB Value Card */}
          <div className="space-y-3 lg:col-span-1">
            <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-teal-400" />
                  GetResponse Status
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                    result.found_object
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {result.found_object ? '0: noError' : '2: noSuchName'}
                </span>
              </div>

              {/* Resolved Object details */}
              {result.found_object ? (
                <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-slate-400 text-[10px]">
                    <span className="text-teal-400 font-semibold">{result.found_object.name}</span>
                    <span className="bg-slate-800 px-1.5 rounded">{result.found_object.syntax}</span>
                  </div>
                  <div className="text-emerald-400 font-semibold text-sm break-all">
                    {result.found_object.value}
                  </div>
                  <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                    {result.found_object.description}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-950 rounded-lg border border-rose-900/60 text-xs text-rose-300 italic text-center">
                  Error: OID {result.config.requested_oid} was not found in the managed device&apos;s MIB tree.
                </div>
              )}

              {/* Metrics */}
              <div className="pt-2 border-t border-slate-800/70 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 block">Round-Trip Time</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.metrics.transaction_duration_us.toLocaleString()} µs
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Packets</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.packets.length} UDP Datagrams
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Payload Sent</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.metrics.payload_bytes_sent} B
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Payload Received</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.metrics.payload_bytes_received} B
                  </span>
                </div>
              </div>
            </div>

            {/* MIB Tree Reference */}
            <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800/80">
              <span className="text-xs font-semibold text-slate-400 block mb-2">Available MIB-2 Tree Objects</span>
              <div className="space-y-1.5 text-[11px] font-mono">
                {DEFAULT_MIB_OBJECTS.map((obj) => (
                  <div
                    key={obj.name}
                    onClick={() => setRequestedOid(obj.oid)}
                    className="p-1.5 rounded bg-slate-950/60 hover:bg-slate-800/60 cursor-pointer border border-slate-800/40 flex justify-between items-center"
                  >
                    <div>
                      <div className="text-teal-300 font-medium">{obj.name}</div>
                      <div className="text-[9px] text-slate-500">{obj.oid}</div>
                    </div>
                    <span className="text-[10px] text-slate-400 font-semibold">{obj.syntax}</span>
                  </div>
                ))}
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
