import React, { useState } from 'react';
import { Play, Database, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import { Project } from '../../types/project';
import {
  DnsConfig,
  DnsRecord,
  DnsRecordType,
  DnsQueryMode,
  DnsSimResult,
} from '../../types/application';
import { ApplicationProtocolTimeline } from './ApplicationProtocolTimeline';
import { Packet } from '../../types/packet';

interface DnsStudioProps {
  project?: Project | null;
  onPacketSelect?: (packet: Packet | null) => void;
  selectedPacketId?: string | null;
}

const DEFAULT_ZONE_RECORDS: DnsRecord[] = [
  { name: 'example.com', record_type: 'A', value: '93.184.216.34', ttl: 300, priority: null },
  { name: 'www.example.com', record_type: 'A', value: '93.184.216.34', ttl: 300, priority: null },
  {
    name: 'ipv6.example.com',
    record_type: 'AAAA',
    value: '2606:2800:220:1:248:1893:25c8:1946',
    ttl: 300,
    priority: null,
  },
  { name: 'alias.example.com', record_type: 'CNAME', value: 'www.example.com', ttl: 300, priority: null },
  { name: 'example.com', record_type: 'MX', value: 'mail.example.com', ttl: 300, priority: 10 },
];

export const DnsStudio: React.FC<DnsStudioProps> = ({
  project,
  onPacketSelect,
  selectedPacketId,
}) => {
  const [clientNode, setClientNode] = useState<string>('');
  const [serverNode, setServerNode] = useState<string>('dns-resolver');
  const [authServerNode, setAuthServerNode] = useState<string>('dns-auth');
  const [queryName, setQueryName] = useState<string>('www.example.com');
  const [queryType, setQueryType] = useState<DnsRecordType>('A');
  const [queryMode, setQueryMode] = useState<DnsQueryMode>('recursive');
  const [queryId, setQueryId] = useState<number>(1001);
  const [seed] = useState<number>(42);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<DnsSimResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync available nodes
  React.useEffect(() => {
    if (project?.nodes && project.nodes.length >= 2) {
      setClientNode(project.nodes[0].id);
      setServerNode(project.nodes[1].id);
      if (project.nodes.length >= 3) {
        setAuthServerNode(project.nodes[2].id);
      }
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
      const config: DnsConfig = {
        client_node_id: clientNode,
        server_node_id: serverNode,
        auth_server_node_id: queryMode === 'iterative' ? authServerNode : undefined,
        query_name: queryName.trim(),
        query_type: queryType,
        query_mode: queryMode,
        query_id: queryId,
        custom_records: DEFAULT_ZONE_RECORDS,
        seed,
      };

      const res = await api.simulateDns(config);
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
      {/* Query presets */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="text-xs font-medium text-slate-400">Query presets</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setQueryName('www.example.com');
              setQueryType('A');
              setQueryMode('recursive');
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
          >
            A Record
          </button>
          <button
            type="button"
            onClick={() => {
              setQueryName('ipv6.example.com');
              setQueryType('AAAA');
              setQueryMode('recursive');
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
          >
            AAAA (IPv6)
          </button>
          <button
            type="button"
            onClick={() => {
              setQueryName('alias.example.com');
              setQueryType('CNAME');
              setQueryMode('recursive');
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
          >
            CNAME
          </button>
          <button
            type="button"
            onClick={() => {
              setQueryName('example.com');
              setQueryType('MX');
              setQueryMode('recursive');
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
          >
            MX
          </button>
          <button
            type="button"
            onClick={() => {
              setQueryName('nxdomain.example.com');
              setQueryType('A');
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-rose-950/60 text-rose-300 hover:bg-rose-900/60 rounded-lg border border-rose-800/60 transition-colors"
          >
            NXDOMAIN
          </button>
        </div>
      </div>

      {/* Configuration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/40 p-3.5 rounded-xl border border-slate-800/80">
        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Client Node</label>
          <select aria-label="Client Node"
            value={clientNode}
            onChange={(e) => setClientNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          >
            {(project?.nodes ?? []).length > 0 ? (
              (project?.nodes ?? []).map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({n.id})
                </option>
              ))
            ) : (
              <option value={clientNode}>{clientNode}</option>
            )}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Local DNS Resolver</label>
          <select aria-label="Local DNS Resolver"
            value={serverNode}
            onChange={(e) => setServerNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          >
            {(project?.nodes ?? []).length > 0 ? (
              (project?.nodes ?? []).map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({n.id})
                </option>
              ))
            ) : (
              <option value={serverNode}>{serverNode}</option>
            )}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Query Domain Name</label>
          <input aria-label="Query Domain Name"
            type="text"
            value={queryName}
            onChange={(e) => setQueryName(e.target.value)}
            placeholder="e.g. www.example.com"
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Record Type</label>
          <select aria-label="Record Type"
            value={queryType}
            onChange={(e) => setQueryType(e.target.value as DnsRecordType)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-medium"
          >
            <option value="A">A (IPv4 Address)</option>
            <option value="AAAA">AAAA (IPv6 Address)</option>
            <option value="CNAME">CNAME (Canonical Alias)</option>
            <option value="MX">MX (Mail Exchange)</option>
          </select>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Query Resolution Mode</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setQueryMode('recursive')}
              className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                queryMode === 'recursive'
                  ? 'bg-brand-600/30 border-brand-500 text-brand-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              Recursive
            </button>
            <button
              type="button"
              onClick={() => setQueryMode('iterative')}
              className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                queryMode === 'iterative'
                  ? 'bg-brand-600/30 border-brand-500 text-brand-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              Iterative
            </button>
          </div>
        </div>

        {queryMode === 'iterative' && (
          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">DNS server node</label>
            <input aria-label="DNS server node"
              type="text"
              value={authServerNode}
              onChange={(e) => setAuthServerNode(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
            />
          </div>
        )}

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Transaction ID (query_id)</label>
          <input aria-label="Transaction ID (query_id)"
            type="number"
            value={queryId}
            onChange={(e) => setQueryId(Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={runSimulation}
            disabled={isRunning}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs rounded shadow transition-colors disabled:bg-slate-700 disabled:text-slate-300"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isRunning ? 'Resolving...' : 'Simulate DNS Query'}
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
          {/* Answer Card & Metrics */}
          <div className="space-y-3 lg:col-span-1">
            <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-brand-400" />
                  Resolution Outcome
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                    result.response_code === 'NOERROR'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {result.response_code}
                </span>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 font-semibold block mb-1">Answer Records</span>
                {result.answers.length === 0 ? (
                  <div className="p-3 bg-slate-950/70 rounded-lg text-slate-400 text-xs italic text-center border border-slate-800/80">
                    No resource records found for this domain name (NXDOMAIN).
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {result.answers.map((rec, i) => (
                      <div
                        key={i}
                        className="p-2 bg-slate-950 rounded-lg border border-slate-800/90 text-xs font-mono space-y-0.5"
                      >
                        <div className="flex justify-between text-slate-400 text-[10px]">
                          <span>{rec.name}</span>
                          <span className="text-brand-400 font-bold">{rec.record_type}</span>
                        </div>
                        <div className="text-emerald-400 font-semibold break-all">{rec.value}</div>
                        <div className="text-[10px] text-slate-500">
                          TTL: {rec.ttl}s {rec.priority !== null && `• Priority: ${rec.priority}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Performance Metrics */}
              <div className="pt-2 border-t border-slate-800/70 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 block">Duration</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.metrics.transaction_duration_us.toLocaleString()} µs
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Packets</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.packets.length} UDP frames
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

            {/* Zone Records Overview */}
            <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800/80">
              <span className="text-xs font-semibold text-slate-400 block mb-2">Configured Zone Table</span>
              <div className="space-y-1 text-[11px] font-mono max-h-36 overflow-y-auto">
                {DEFAULT_ZONE_RECORDS.map((rec, i) => (
                  <div key={i} className="flex justify-between py-0.5 border-b border-slate-800/40 text-slate-400">
                    <span>{rec.name}</span>
                    <span className="text-brand-400">{rec.record_type}</span>
                    <span className="text-slate-300 truncate max-w-[120px]">{rec.value}</span>
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
