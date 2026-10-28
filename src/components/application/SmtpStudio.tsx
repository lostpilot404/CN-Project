import React, { useState } from 'react';
import { Play, Mail, CheckCircle2, XCircle, AlertTriangle, UserCheck, UserX } from 'lucide-react';
import { api } from '../../lib/api';
import { Project } from '../../types/project';
import {
  SmtpConfig,
  SmtpSimResult,
} from '../../types/application';
import { ApplicationProtocolTimeline } from './ApplicationProtocolTimeline';
import { Packet } from '../../types/packet';

interface SmtpStudioProps {
  project?: Project | null;
  onPacketSelect?: (packet: Packet | null) => void;
  selectedPacketId?: string | null;
}

export const SmtpStudio: React.FC<SmtpStudioProps> = ({
  project,
  onPacketSelect,
  selectedPacketId,
}) => {
  const [clientNode, setClientNode] = useState<string>('');
  const [serverNode, setServerNode] = useState<string>('mail-server');
  const [mailFrom, setMailFrom] = useState<string>('alice@example.com');
  const [rcptTo, setRcptTo] = useState<string>('bob@example.com');
  const [subject, setSubject] = useState<string>('Quarterly Network Simulation Report');
  const [body, setBody] = useState<string>(
    'Hello Bob,\nHere is the updated NetSim simulation data for our network protocols coursework.\nRegards,\nAlice'
  );
  const [rejectRecipient, setRejectRecipient] = useState<boolean>(false);
  const [port, setPort] = useState<number>(25);
  const [seed] = useState<number>(42);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<SmtpSimResult | null>(null);
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
      const config: SmtpConfig = {
        client_node_id: clientNode,
        server_node_id: serverNode,
        mail_from: mailFrom.trim(),
        rcpt_to: rcptTo.trim(),
        subject: subject.trim(),
        body: body.trim(),
        reject_recipient: rejectRecipient,
        port,
        seed,
      };

      const res = await api.simulateSmtp(config);
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
          <div className="p-2 bg-brand-500/10 rounded-lg text-brand-400">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Simple Mail Transfer Protocol (SMTP) Studio</h3>
            <p className="text-xs text-slate-400">
              Interactive mail delivery state machine (220, EHLO, MAIL FROM, RCPT TO, DATA, QUIT) over TCP port 25.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRcptTo('bob@example.com');
              setRejectRecipient(false);
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60 rounded-lg border border-emerald-800/60 transition-colors"
          >
            Accepted Delivery (250)
          </button>
          <button
            type="button"
            onClick={() => {
              setRcptTo('unknown_user@example.com');
              setRejectRecipient(true);
            }}
            className="px-2.5 py-1 text-[11px] font-medium bg-rose-950/60 text-rose-300 hover:bg-rose-900/60 rounded-lg border border-rose-800/60 transition-colors"
          >
            Rejected Recipient (550)
          </button>
        </div>
      </div>

      {/* Config Form */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/40 p-3.5 rounded-xl border border-slate-800/80">
        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Mail Client (MUA)</label>
          <input aria-label="Mail Client (MUA)"
            type="text"
            value={clientNode}
            onChange={(e) => setClientNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Mail Transfer Agent (MTA)</label>
          <input aria-label="Mail Transfer Agent (MTA)"
            type="text"
            value={serverNode}
            onChange={(e) => setServerNode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Sender (MAIL FROM)</label>
          <input aria-label="Sender (MAIL FROM)"
            type="text"
            value={mailFrom}
            onChange={(e) => setMailFrom(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Recipient (RCPT TO)</label>
          <input aria-label="Recipient (RCPT TO)"
            type="text"
            value={rcptTo}
            onChange={(e) => setRcptTo(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Mail Subject</label>
          <input aria-label="Mail Subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Recipient Policy Check</label>
          <button
            type="button"
            onClick={() => setRejectRecipient(!rejectRecipient)}
            className={`w-full py-1.5 px-2.5 rounded text-xs font-medium border flex items-center justify-center gap-1.5 transition-colors ${
              rejectRecipient
                ? 'bg-rose-950/60 border-rose-800 text-rose-300'
                : 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
            }`}
          >
            {rejectRecipient ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
            {rejectRecipient ? 'Reject Recipient (550)' : 'Accept Recipient (250)'}
          </button>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">SMTP Port</label>
          <input aria-label="SMTP Port"
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-200 font-mono"
          />
        </div>

        <div className="md:col-span-3">
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Message Content (DATA)</label>
          <textarea aria-label="Message Content (DATA)"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-950 rounded border border-slate-800 text-xs text-slate-300 font-mono resize-none"
          />
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={runSimulation}
            disabled={isRunning}
            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs rounded-lg shadow transition-colors disabled:bg-slate-700 disabled:text-slate-300"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isRunning ? 'Submitting Mail...' : 'Deliver SMTP Message'}
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
          {/* Status & Envelope Card */}
          <div className="space-y-3 lg:col-span-1">
            <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-brand-400" />
                  Transaction Status
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold flex items-center gap-1 ${
                    result.is_accepted
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {result.is_accepted ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {result.is_accepted ? '250 QUEUED' : '550 REJECTED'}
                </span>
              </div>

              {/* Envelope details */}
              <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 text-xs space-y-1 font-mono">
                <div className="text-slate-400">
                  <span className="text-brand-400">FROM:</span> {result.config.mail_from}
                </div>
                <div className="text-slate-400">
                  <span className="text-brand-400">TO:</span> {result.config.rcpt_to}
                </div>
                <div className="text-slate-400 truncate">
                  <span className="text-brand-400">SUBJ:</span> {result.config.subject}
                </div>
                <div className="text-slate-500 text-[10px] pt-1 border-t border-slate-800/80">
                  Transport: TCP Port {result.config.port} • State: {result.state}
                </div>
              </div>

              {/* Metrics */}
              <div className="pt-2 border-t border-slate-800/70 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 block">Total Duration</span>
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
                  <span className="text-[10px] text-slate-500 block">Status Messages</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {result.metrics.responses_received} replies
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
