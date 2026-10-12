import React, { useState } from 'react';
import { Play, Globe2, FileText, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import { Project } from '../../types/project';
import {
  HttpConfig,
  HttpMethod,
  HttpRequest,
  HttpSimResult,
} from '../../types/application';
import { ApplicationProtocolTimeline } from './ApplicationProtocolTimeline';
import { Packet } from '../../types/packet';

interface HttpStudioProps {
  project?: Project | null;
  onPacketSelect?: (packet: Packet | null) => void;
  selectedPacketId?: string | null;
}

export const HttpStudio: React.FC<HttpStudioProps> = ({
  project,
  onPacketSelect,
  selectedPacketId,
}) => {
  const [clientNode, setClientNode] = useState<string>('');
  const [serverNode, setServerNode] = useState<string>('web-server');
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState<string>('/index.html');
  const [headersText, setHeadersText] = useState<string>(
    'Host: example.com\nUser-Agent: NetSim-Client/1.0\nAccept: text/html,application/xhtml+xml'
  );
  const [bodyText, setBodyText] = useState<string>('{\n  "client": "NetSim",\n  "status": "active"\n}');
  const [port] = useState<number>(80);
  const [seed] = useState<number>(42);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<HttpSimResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync available nodes
  React.useEffect(() => {
    if (project?.nodes && project.nodes.length >= 2) {
      setClientNode(project.nodes[0].id);
      setServerNode(project.nodes[1].id);
    }
  }, [project]);

  const parseHeaders = (raw: string): Record<string, string> => {
    const map: Record<string, string> = {};
    const lines = raw.split('\n');
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const k = line.substring(0, idx).trim();
        const v = line.substring(idx + 1).trim();
        if (k.length > 0) {
          map[k] = v;
        }
      }
    }
    return map;
  };

  const runSimulation = async () => {
    if (!clientNode || !serverNode) {
      setErrorMsg('Add at least two devices to the topology before running a simulation.');
      return;
    }
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const headers = parseHeaders(headersText);
      const request: HttpRequest = {
        method,
        path: path.trim(),
        headers,
        body: method === 'POST' ? bodyText : null,
      };

      const config: HttpConfig = {
        client_node_id: clientNode,
        server_node_id: serverNode,
        request,
        port,
        seed,
      };

      const res = await api.simulateHttp(config);
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
          <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
            <Globe2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Hypertext Transfer Protocol (HTTP/1.1) Studio</h3>
            <p className="text-xs text-slate-400">
              Request/response transactions executed over authentic multi-hop TCP transport connections.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMethod('GET');
              setPath('/index.html');
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
          >
            GET / (200 OK)
          </button>
          <button
            type="button"
            onClick={() => {
              setMethod('GET');
              setPath('/not-found');
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-rose-950/60 text-rose-300 hover:bg-rose-900/60 rounded-lg border border-rose-800/60 transition-colors"
          >
            GET /not-found (404)
          </button>
          <button
            type="button"
            onClick={() => {
              setMethod('POST');
              setPath('/api/feedback');
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-brand-950/60 text-brand-300 hover:bg-brand-900/60 rounded-lg border border-brand-800/60 transition-colors"
          >
            POST /api/feedback
          </button>
        </div>
      </div>

      {/* Configuration Form */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/40 p-3.5 rounded-xl border border-slate-800/80">
        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Client Host</label>
          <input
            type="text"
            value={clientNode}
            onChange={(e) => setClientNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Web Server Node</label>
          <input
            type="text"
            value={serverNode}
            onChange={(e) => setServerNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">HTTP Method</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMethod('GET')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded border transition-colors ${
                method === 'GET'
                  ? 'bg-emerald-600/30 border-emerald-500 text-emerald-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              GET
            </button>
            <button
              type="button"
              onClick={() => setMethod('POST')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded border transition-colors ${
                method === 'POST'
                  ? 'bg-emerald-600/30 border-emerald-500 text-emerald-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              POST
            </button>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Resource Path</label>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Request Headers (Key: Value)</label>
          <textarea
            rows={2}
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-300 font-mono resize-none"
          />
        </div>

        {method === 'POST' ? (
          <div className="md:col-span-2">
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">POST Request Body</label>
            <textarea
              rows={2}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-300 font-mono resize-none"
            />
          </div>
        ) : (
          <div className="md:col-span-2 flex items-center p-2 bg-slate-950/40 rounded border border-slate-800/60 text-slate-400 text-xs italic">
            GET requests do not include an entity body payload.
          </div>
        )}

        <div className="md:col-span-4 flex justify-end">
          <button
            type="button"
            onClick={runSimulation}
            disabled={isRunning}
            className="flex items-center gap-1.5 py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs rounded-lg shadow transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isRunning ? 'Executing HTTP Transaction...' : 'Send HTTP Request (Over TCP)'}
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
          {/* Response Inspector Card */}
          <div className="space-y-3 lg:col-span-1">
            <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-emerald-400" />
                  HTTP Response
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                    result.response.status_code === 200
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {result.response.status_code} {result.response.status_text}
                </span>
              </div>

              {/* Response Headers */}
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block mb-1">Response Headers</span>
                <div className="p-2 bg-slate-950 rounded-lg border border-slate-800 font-mono text-[11px] space-y-0.5 max-h-24 overflow-y-auto">
                  {Object.entries(result.response.headers).map(([k, v]) => (
                    <div key={k} className="text-slate-400">
                      <span className="text-emerald-400">{k}:</span> {v}
                    </div>
                  ))}
                </div>
              </div>

              {/* Response Body Preview */}
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block mb-1">Response Body</span>
                <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                  {result.response.body}
                </div>
              </div>

              {/* Transaction Metrics */}
              <div className="pt-2 border-t border-slate-800/70 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 block">Total Latency</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.metrics.transaction_duration_us.toLocaleString()} µs
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Packets</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.packets.length} TCP Segments
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
