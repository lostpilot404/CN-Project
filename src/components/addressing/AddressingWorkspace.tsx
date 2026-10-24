import React, { useState, useEffect, useCallback } from 'react';
import {
  Hash,
  Sliders,
  Layers,
  AlertTriangle,
  Globe,
  Shuffle,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Search,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { Project } from '../../types/project';
import {
  Ipv4SubnetInfo,
  SubnetSplitResult,
  VlsmSubnetRequirement,
  VlsmAllocationResult,
  DuplicateIpConflict,
  Ipv6Info,
  NatProtocol,
  NatTable,
  NatTranslationResult,
} from '../../types/addressing';
import { api } from '../../lib/api';

interface AddressingWorkspaceProps {
  project: Project | null;
}

type AddressingSubTab = 'ipv4' | 'vlsm' | 'conflicts' | 'ipv6' | 'nat';

export const AddressingWorkspace: React.FC<AddressingWorkspaceProps> = ({ project }) => {
  const [subTab, setSubTab] = useState<AddressingSubTab>('ipv4');

  // IPv4 state
  const [ipv4Input, setIpv4Input] = useState<string>('192.168.1.0/24');
  const [subnetInfo, setSubnetInfo] = useState<Ipv4SubnetInfo | null>(null);
  const [splitPrefix, setSplitPrefix] = useState<number>(26);
  const [splitResult, setSplitResult] = useState<SubnetSplitResult | null>(null);

  // VLSM state
  const [vlsmBaseCidr, setVlsmBaseCidr] = useState<string>('192.168.1.0/24');
  const [vlsmReqs, setVlsmReqs] = useState<VlsmSubnetRequirement[]>([
    { name: 'Engineering', needed_hosts: 100 },
    { name: 'Sales & Marketing', needed_hosts: 50 },
    { name: 'Support', needed_hosts: 25 },
    { name: 'WAN Link', needed_hosts: 2 },
  ]);
  const [vlsmResult, setVlsmResult] = useState<VlsmAllocationResult | null>(null);

  // Duplicate IP state
  const [duplicateConflicts, setDuplicateConflicts] = useState<DuplicateIpConflict[]>([]);

  // IPv6 state
  const [ipv6Input, setIpv6Input] = useState<string>('2001:0db8:0000:0000:0000:0000:0000:0001/64');
  const [ipv6Info, setIpv6Info] = useState<Ipv6Info | null>(null);

  // NAT state
  const routers = project?.nodes.filter((n) => n.node_type === 'router') || [];
  const [natRouterId, setNatRouterId] = useState<string>('');
  const [natPublicIp, setNatPublicIp] = useState<string>('203.0.113.1');
  const [natTable, setNatTable] = useState<NatTable | null>(null);
  const [natProtocol, setNatProtocol] = useState<NatProtocol>('TCP');
  const [testSrcIp, setTestSrcIp] = useState<string>('192.168.1.50');
  const [testSrcPort, setTestSrcPort] = useState<number>(50000);
  const [testDstIp, setTestDstIp] = useState<string>('93.184.216.34');
  const [testDstPort, setTestDstPort] = useState<number>(443);
  const [natOutResult, setNatOutResult] = useState<NatTranslationResult | null>(null);
  const [natInResult, setNatInResult] = useState<NatTranslationResult | null>(null);

  // Static DNAT form state
  const [dnatPort, setDnatPort] = useState<number>(80);
  const [dnatPrivateIp, setDnatPrivateIp] = useState<string>('192.168.1.10');
  const [dnatPrivatePort, setDnatPrivatePort] = useState<number>(8080);
  const [dnatDesc, setDnatDesc] = useState<string>('Web Server Forwarding');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Calculate IPv4 subnet
  const calculateIpv4 = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await api.calculateIpv4Subnet(ipv4Input);
      setSubnetInfo(res);
    } catch (err: unknown) {
      // A failed calculation must not leave the previous successful result on screen as
      // if it belonged to the current input.
      setSubnetInfo(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [ipv4Input]);

  useEffect(() => {
    calculateIpv4();
  }, [calculateIpv4]);

  // Split equal subnets
  const handleSplitSubnet = async () => {
    try {
      setErrorMsg(null);
      const res = await api.splitIpv4Subnet(ipv4Input, splitPrefix);
      setSplitResult(res);
    } catch (err: unknown) {
      setSplitResult(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Run VLSM
  const handleCalculateVlsm = async () => {
    try {
      setErrorMsg(null);
      const res = await api.allocateVlsmSubnets(vlsmBaseCidr, vlsmReqs);
      setVlsmResult(res);
    } catch (err: unknown) {
      setVlsmResult(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Run Duplicate IP check
  const handleAuditIps = useCallback(async () => {
    try {
      setErrorMsg(null);
      const conflicts = await api.detectDuplicateIps();
      setDuplicateConflicts(conflicts);
    } catch (err: unknown) {
      setDuplicateConflicts([]);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (subTab === 'conflicts') {
      handleAuditIps();
    }
  }, [subTab, handleAuditIps]);

  // Validate IPv6
  const handleValidateIpv6 = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await api.validateIpv6Address(ipv6Input);
      setIpv6Info(res);
    } catch (err: unknown) {
      setIpv6Info(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [ipv6Input]);

  useEffect(() => {
    if (subTab === 'ipv6') {
      handleValidateIpv6();
    }
  }, [subTab, handleValidateIpv6]);

  // NAT: Load or Create Table
  useEffect(() => {
    if (routers.length > 0 && !natRouterId) {
      setNatRouterId(routers[0].id);
    }
  }, [routers, natRouterId]);

  const loadNatTable = useCallback(async () => {
    if (!natRouterId) return;
    try {
      setErrorMsg(null);
      const tbl = await api.getOrCreateNatTable(natRouterId, natPublicIp);
      setNatTable(tbl);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [natRouterId, natPublicIp]);

  useEffect(() => {
    if (subTab === 'nat' && natRouterId) {
      loadNatTable();
    }
  }, [subTab, natRouterId, loadNatTable]);

  // Add Static DNAT Rule
  const handleAddDnatRule = async () => {
    if (!natRouterId) return;
    try {
      setErrorMsg(null);
      const updated = await api.addStaticDnatRule(
        natRouterId,
        natPublicIp,
        natProtocol,
        dnatPort,
        dnatPrivateIp,
        dnatPrivatePort,
        dnatDesc
      );
      setNatTable(updated);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Test Outbound NAT
  const handleTestOutbound = async () => {
    if (!natRouterId) return;
    try {
      setErrorMsg(null);
      const res = await api.simulateNatOutbound(
        natRouterId,
        natPublicIp,
        testSrcIp,
        testSrcPort,
        testDstIp,
        testDstPort,
        natProtocol
      );
      setNatOutResult(res);
      await loadNatTable();
    } catch (err: unknown) {
      setNatOutResult(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Test Inbound NAT
  const handleTestInbound = async () => {
    if (!natRouterId) return;
    try {
      setErrorMsg(null);
      const res = await api.simulateNatInbound(
        natRouterId,
        natPublicIp,
        testDstIp,
        testDstPort,
        natPublicIp,
        dnatPort,
        natProtocol
      );
      setNatInResult(res);
      await loadNatTable();
    } catch (err: unknown) {
      setNatInResult(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-800 gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30">
            <Hash className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              Addressing & Translation Studio
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Authoritative Python Core
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              IPv4/CIDR calculations, true VLSM allocation, duplicate IP auditing, IPv6 RFC 5952, and stateful NAT/NAPT
            </p>
          </div>
        </div>
      </div>

      {/* Workspace Sub-tabs Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800/80 pb-3">
        {[
          { id: 'ipv4', label: 'IPv4 & CIDR Subnetting', icon: Sliders },
          { id: 'vlsm', label: 'True VLSM Allocator', icon: Layers },
          { id: 'conflicts', label: 'Topology IP Auditor', icon: AlertTriangle },
          { id: 'ipv6', label: 'IPv6 Inspector', icon: Globe },
          { id: 'nat', label: 'NAT / NAPT Translation', icon: Shuffle },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setSubTab(tab.id as AddressingSubTab);
                setErrorMsg(null);
              }}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
                isActive
                  ? 'bg-emerald-600/25 border-emerald-500/80 text-emerald-300 shadow-sm'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.id === 'conflicts' && duplicateConflicts.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-700 text-white font-bold">
                  {duplicateConflicts.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs text-rose-300 flex items-center space-x-2">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* SUB-TAB 1: IPv4 & CIDR Subnetting */}
      {subTab === 'ipv4' && (
        <div className="space-y-6">
          {/* Input strip */}
          <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row items-center gap-4">
            <div className="flex-1 w-full">
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                IPv4 Address with CIDR Prefix or Subnet Mask
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={ipv4Input}
                  onChange={(e) => setIpv4Input(e.target.value)}
                  placeholder="e.g. 192.168.1.100/24 or 10.0.0.1 255.255.255.0"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={calculateIpv4}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg transition"
                >
                  Calculate
                </button>
              </div>
            </div>
            {subnetInfo && (
              <div className="w-full md:w-64">
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Prefix Slider: /{subnetInfo.prefix_length}
                </label>
                <input
                  aria-label="Prefix Slider"
                  type="range"
                  min="0"
                  max="32"
                  value={subnetInfo.prefix_length}
                  onChange={(e) => {
                    const newP = e.target.value;
                    const ipOnly = ipv4Input.split('/')[0].split(' ')[0];
                    setIpv4Input(`${ipOnly}/${newP}`);
                  }}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* Subnet Results Grid */}
          {subnetInfo && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/70 border border-slate-800 p-4 rounded-xl space-y-1">
                <span className="text-[11px] text-slate-400 font-semibold uppercase">Network Address</span>
                <p className="text-base font-bold font-mono text-emerald-400">{subnetInfo.network_address}</p>
                <span className="text-[10px] text-slate-400 font-mono">/{subnetInfo.prefix_length}</span>
              </div>
              <div className="bg-slate-900/70 border border-slate-800 p-4 rounded-xl space-y-1">
                <span className="text-[11px] text-slate-400 font-semibold uppercase">Broadcast Address</span>
                <p className="text-base font-bold font-mono text-slate-200">{subnetInfo.broadcast_address}</p>
                <span className="text-[10px] text-slate-400 font-mono">Wildcard: {subnetInfo.wildcard_mask}</span>
              </div>
              <div className="bg-slate-900/70 border border-slate-800 p-4 rounded-xl space-y-1">
                <span className="text-[11px] text-slate-400 font-semibold uppercase">Usable Host Range</span>
                <p className="text-xs font-bold font-mono text-slate-200">
                  {subnetInfo.first_usable_ip} - {subnetInfo.last_usable_ip}
                </p>
                <span className="text-[10px] text-brand-400 font-mono">
                  {subnetInfo.usable_hosts.toLocaleString()} usable ({subnetInfo.total_hosts.toLocaleString()} total)
                </span>
              </div>
              <div className="bg-slate-900/70 border border-slate-800 p-4 rounded-xl space-y-1">
                <span className="text-[11px] text-slate-400 font-semibold uppercase">Classification & Scope</span>
                <p className="text-xs font-bold text-slate-200">{subnetInfo.ip_class}</p>
                <span className="text-[10px] text-slate-400">{subnetInfo.scope}</span>
              </div>
            </div>
          )}

          {/* Binary Representation */}
          {subnetInfo && (
            <div className="bg-slate-900/70 border border-slate-800 p-4 rounded-xl space-y-3 font-mono text-xs">
              <h4 className="font-semibold text-slate-300 uppercase tracking-wider font-sans text-xs">
                Binary Dotted Notation
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-sans">IP Address Binary:</span>
                  <div className="p-2 bg-slate-950 rounded border border-slate-800 text-emerald-300">
                    {subnetInfo.ip_binary}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-sans">Subnet Mask Binary:</span>
                  <div className="p-2 bg-slate-950 rounded border border-slate-800 text-slate-300">
                    {subnetInfo.mask_binary}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Equal-Prefix Subnet Splitting */}
          <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Equal-Prefix Subnet Splitting
                </h4>
                <p className="text-xs text-slate-400">
                  Splits base CIDR block into equal smaller subnets (distinct from VLSM)
                </p>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs text-slate-400">Target Prefix:</span>
                <select
                  aria-label="Target Prefix"
                  value={splitPrefix}
                  onChange={(e) => setSplitPrefix(parseInt(e.target.value, 10))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200"
                >
                  {Array.from({ length: 32 }, (_, i) => i + 1)
                    .filter((p) => p > (subnetInfo?.prefix_length || 0))
                    .map((p) =>
                      subnetInfo ? (
                        <option key={p} value={p}>
                          /{p} ({Math.pow(2, p - subnetInfo.prefix_length)} subnets)
                        </option>
                      ) : (
                        <option key={p} value={p}>
                          /{p}
                        </option>
                      )
                    )}
                </select>
                <button
                  onClick={handleSplitSubnet}
                  className="px-3.5 py-1 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg transition"
                >
                  Generate Subnets
                </button>
              </div>
            </div>

            {splitResult && (
              <div className="overflow-x-auto max-h-60 border border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-sans">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Subnet CIDR</th>
                      <th className="py-2 px-3">Netmask</th>
                      <th className="py-2 px-3">Usable Range</th>
                      <th className="py-2 px-3">Broadcast</th>
                      <th className="py-2 px-3">Usable Hosts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {splitResult.subnets.map((sub, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-1.5 px-3 text-slate-500">{idx + 1}</td>
                        <td className="py-1.5 px-3 font-semibold text-emerald-400">
                          {sub.network_address}/{sub.prefix_length}
                        </td>
                        <td className="py-1.5 px-3 text-slate-400">{sub.subnet_mask}</td>
                        <td className="py-1.5 px-3">
                          {sub.first_usable_ip} - {sub.last_usable_ip}
                        </td>
                        <td className="py-1.5 px-3 text-slate-400">{sub.broadcast_address}</td>
                        <td className="py-1.5 px-3 font-bold text-brand-300">{sub.usable_hosts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: True VLSM Allocator */}
      {subTab === 'vlsm' && (
        <div className="space-y-6">
          <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  True VLSM (Variable Length Subnet Mask) Allocation
                </h4>
                <p className="text-xs text-slate-400">
                  Sorts requirements descending, computes minimal power-of-two blocks, aligns boundaries, and minimizes wasted addresses
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">Base CIDR:</span>
                <input
                  aria-label="Base CIDR"
                  type="text"
                  value={vlsmBaseCidr}
                  onChange={(e) => setVlsmBaseCidr(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1 text-xs text-slate-200 font-mono w-36"
                />
                <button
                  onClick={handleCalculateVlsm}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg transition"
                >
                  Allocate VLSM
                </button>
              </div>
            </div>

            {/* Requirements list editor */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase">Subnet Requirements:</span>
              <div className="space-y-2">
                {vlsmReqs.map((req, idx) => (
                  <div key={idx} className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={req.name}
                      onChange={(e) => {
                        const updated = [...vlsmReqs];
                        updated[idx].name = e.target.value;
                        setVlsmReqs(updated);
                      }}
                      placeholder="Subnet Name"
                      className="flex-1 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1 text-xs text-slate-200"
                    />
                    <input
                      type="number"
                      min="1"
                      value={req.needed_hosts}
                      onChange={(e) => {
                        const updated = [...vlsmReqs];
                        updated[idx].needed_hosts = parseInt(e.target.value, 10) || 1;
                        setVlsmReqs(updated);
                      }}
                      placeholder="Needed Hosts"
                      className="w-32 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1 text-xs text-slate-200 font-mono"
                    />
                    <button
                      aria-label={`Remove requirement ${idx + 1}`}
                      onClick={() => setVlsmReqs(vlsmReqs.filter((_, i) => i !== idx))}
                      className="p-1.5 text-slate-400 hover:text-rose-400 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() =>
                  setVlsmReqs([
                    ...vlsmReqs,
                    { name: `Subnet ${vlsmReqs.length + 1}`, needed_hosts: 10 },
                  ])
                }
                className="flex items-center space-x-1.5 text-xs text-brand-400 hover:text-brand-300 font-medium pt-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Subnet Requirement</span>
              </button>
            </div>
          </div>

          {/* VLSM Results */}
          {vlsmResult && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Needed</span>
                  <p className="text-base font-bold text-slate-200">{vlsmResult.total_needed_hosts} hosts</p>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Allocated Capacity</span>
                  <p className="text-base font-bold text-emerald-400">{vlsmResult.total_allocated_hosts} hosts</p>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Wasted Addresses</span>
                  <p className="text-base font-bold text-amber-400">{vlsmResult.total_wasted_hosts} hosts</p>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Address Utilization</span>
                  <p className="text-base font-bold text-brand-300">{vlsmResult.utilization_percent}%</p>
                </div>
              </div>

              {/* Allocated Subnets Table */}
              <div className="overflow-x-auto border border-slate-800 rounded-xl bg-slate-900/70">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-sans">
                    <tr>
                      <th className="py-2.5 px-3">Subnet Name</th>
                      <th className="py-2.5 px-3">Needed</th>
                      <th className="py-2.5 px-3">Allocated CIDR</th>
                      <th className="py-2.5 px-3">Netmask</th>
                      <th className="py-2.5 px-3">Usable Range</th>
                      <th className="py-2.5 px-3">Broadcast</th>
                      <th className="py-2.5 px-3">Wasted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {vlsmResult.subnets.map((sub, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-semibold text-slate-200 font-sans">{sub.name}</td>
                        <td className="py-2 px-3 text-slate-400">{sub.needed_hosts}</td>
                        <td className="py-2 px-3 font-bold text-emerald-400">
                          {sub.subnet_info.network_address}/{sub.allocated_prefix}
                        </td>
                        <td className="py-2 px-3 text-slate-400">{sub.subnet_info.subnet_mask}</td>
                        <td className="py-2 px-3">
                          {sub.subnet_info.first_usable_ip} - {sub.subnet_info.last_usable_ip}
                        </td>
                        <td className="py-2 px-3 text-slate-400">{sub.subnet_info.broadcast_address}</td>
                        <td className="py-2 px-3 text-amber-400 font-bold">{sub.wasted_hosts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Free Space */}
              {vlsmResult.free_address_space.length > 0 && (
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-xs text-slate-400 flex items-center space-x-2">
                  <span className="font-semibold text-slate-300">Unallocated Address Space:</span>
                  <span className="font-mono text-emerald-400">{vlsmResult.free_address_space.join(', ')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: Duplicate IP Conflict Auditor */}
      {subTab === 'conflicts' && (
        <div className="space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Topology Interface IPv4 Duplicate Auditor
              </h4>
              <p className="text-xs text-slate-400">
                Authoritatively verifies that every interface in the network topology has a unique IPv4 address
              </p>
            </div>
            <button
              onClick={handleAuditIps}
              className="flex items-center space-x-2 px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg transition"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Rescan Topology</span>
            </button>
          </div>

          {duplicateConflicts.length === 0 ? (
            <div className="p-6 bg-emerald-950/20 border border-emerald-800/40 rounded-xl text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <h4 className="text-sm font-semibold text-emerald-300">No IP Address Conflicts Detected</h4>
              <p className="text-xs text-slate-400">
                All configured network node interfaces have globally unique IPv4 addresses across the active topology.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-rose-400 font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                <span>Found {duplicateConflicts.length} IP conflict(s) across topology devices:</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {duplicateConflicts.map((conf) => (
                  <div key={conf.ip} className="bg-rose-950/30 border border-rose-800/60 p-4 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-rose-300">{conf.ip}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        {conf.occurrences.length} Collisions
                      </span>
                    </div>
                    <div className="space-y-1 pt-1 font-mono text-xs">
                      {conf.occurrences.map((occ, idx) => (
                        <div key={idx} className="flex justify-between items-center text-slate-300 py-0.5">
                          <span>
                            {occ.node_label} ({occ.node_id})
                          </span>
                          <span className="text-slate-400 font-sans text-[11px]">
                            Interface: {occ.interface_name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: IPv6 Inspector */}
      {subTab === 'ipv6' && (
        <div className="space-y-6">
          <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                IPv6 Address with Prefix Length
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={ipv6Input}
                  onChange={(e) => setIpv6Input(e.target.value)}
                  placeholder="e.g. 2001:0db8::1/64 or fe80::1ff:fe00:1"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={handleValidateIpv6}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg transition"
                >
                  Inspect IPv6
                </button>
              </div>
            </div>

            {ipv6Info && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">
                      RFC 5952 Canonical Compressed
                    </span>
                    <p className="text-sm font-bold font-mono text-emerald-400">
                      {ipv6Info.canonical_address}
                    </p>
                  </div>
                  <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">
                      Address Scope & Classification
                    </span>
                    <p className="text-sm font-bold text-slate-200">{ipv6Info.scope}</p>
                  </div>
                </div>

                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">
                    Full Expanded 8-Hextet Representation
                  </span>
                  <p className="text-xs font-mono text-slate-300 break-all">{ipv6Info.expanded_address}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
                  <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-sans uppercase">Network /64 Prefix:</span>
                    <p className="text-brand-300 font-semibold mt-0.5">{ipv6Info.network_prefix}</p>
                  </div>
                  <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-sans uppercase">Interface ID (IID):</span>
                    <p className="text-slate-300 font-semibold mt-0.5">{ipv6Info.interface_identifier}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 5: NAT / NAPT Translation */}
      {subTab === 'nat' && (
        <div className="space-y-6">
          {/* Top Router & Setup bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                NAT Gateway Router
              </label>
              <select aria-label="NAT Gateway Router"
                value={natRouterId}
                onChange={(e) => setNatRouterId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200"
              >
                {routers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} ({r.id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Router Public IPv4 (WAN IP)
              </label>
              <input aria-label="Router Public IPv4 (WAN IP)"
                type="text"
                value={natPublicIp}
                onChange={(e) => setNatPublicIp(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={loadNatTable}
                className="w-full py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg transition"
              >
                Sync NAT Table
              </button>
            </div>
          </div>

          {/* Static DNAT / Port Forwarding Rules Configuration */}
          <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-3">
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Add Static DNAT (Port Forwarding) Rule
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3 items-end">
              <div>
                <label className="block text-[10px] text-slate-400 uppercase">Protocol</label>
                <select aria-label="Protocol"
                  value={natProtocol}
                  onChange={(e) => setNatProtocol(e.target.value as NatProtocol)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200"
                >
                  <option value="TCP">TCP</option>
                  <option value="UDP">UDP</option>
                  <option value="ICMP">ICMP</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase">Public WAN Port</label>
                <input aria-label="Public WAN Port"
                  type="number"
                  value={dnatPort}
                  onChange={(e) => setDnatPort(parseInt(e.target.value, 10) || 80)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase">Private LAN IP</label>
                <input aria-label="Private LAN IP"
                  type="text"
                  value={dnatPrivateIp}
                  onChange={(e) => setDnatPrivateIp(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase">Private Port</label>
                <input aria-label="Private Port"
                  type="number"
                  value={dnatPrivatePort}
                  onChange={(e) => setDnatPrivatePort(parseInt(e.target.value, 10) || 8080)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase">Description</label>
                <input aria-label="Description"
                  type="text"
                  value={dnatDesc}
                  onChange={(e) => setDnatDesc(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200"
                />
              </div>
              <div>
                <button
                  onClick={handleAddDnatRule}
                  className="w-full py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg transition"
                >
                  Add Rule
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Translation Test Chamber */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Outbound Test */}
            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-3">
              <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <ArrowRight className="w-3.5 h-3.5 text-brand-400" />
                Test Outbound SNAT (LAN &rarr; WAN)
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <span className="text-[10px] font-sans text-slate-400">Src IP:Port</span>
                  <input
                    aria-label="Src IP:Port"
                    type="text"
                    value={testSrcIp}
                    onChange={(e) => setTestSrcIp(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-sans text-slate-400">Src Port</span>
                  <input
                    aria-label="Src Port"
                    type="number"
                    value={testSrcPort}
                    onChange={(e) => setTestSrcPort(parseInt(e.target.value, 10) || 50000)}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-sans text-slate-400">Dst IP:Port</span>
                  <input
                    aria-label="Dst IP:Port"
                    type="text"
                    value={testDstIp}
                    onChange={(e) => setTestDstIp(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-sans text-slate-400">Dst Port</span>
                  <input
                    aria-label="Dst Port"
                    type="number"
                    value={testDstPort}
                    onChange={(e) => setTestDstPort(parseInt(e.target.value, 10) || 443)}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  />
                </div>
              </div>
              <button
                onClick={handleTestOutbound}
                className="w-full py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg transition"
              >
                Transmit Outbound Packet
              </button>
              {natOutResult && (
                <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 font-mono text-[11px] space-y-1">
                  <div className="text-emerald-400 font-bold">
                    Translated Src: {natOutResult.translated_src_ip}:{natOutResult.translated_src_port}
                  </div>
                  <div className="text-slate-400">
                    Mapping: {natOutResult.created_new_mapping ? 'Created New Dynamic Entry' : 'Reused Existing Session'}
                  </div>
                </div>
              )}
            </div>

            {/* Inbound Test */}
            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-3">
              <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                Test Inbound DNAT (WAN &rarr; LAN)
              </h4>
              <p className="text-xs text-slate-400">
                Sends reply or external request to router public port {dnatPort} or active dynamic port
              </p>
              <button
                onClick={handleTestInbound}
                className="w-full py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg transition mt-8"
              >
                Transmit Inbound Reply
              </button>
              {natInResult && (
                <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 font-mono text-[11px] space-y-1">
                  <div className="text-emerald-400 font-bold">
                    Translated Dst: {natInResult.translated_dst_ip}:{natInResult.translated_dst_port}
                  </div>
                  <div className="text-slate-400">Type: {natInResult.direction}</div>
                </div>
              )}
            </div>
          </div>

          {/* Active NAT Table Display */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden shadow-lg space-y-2">
            <div className="px-4 py-3 bg-slate-850/80 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Stateful NAT Table ({natTable?.entries.length || 0} Dynamic, {natTable?.static_rules.length || 0} Static)
                </h3>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-sans">
                  <tr>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Protocol</th>
                    <th className="py-2.5 px-3">Private IP:Port</th>
                    <th className="py-2.5 px-3">Public IP:Port</th>
                    <th className="py-2.5 px-3">Timeout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {natTable?.static_rules.map((rule) => (
                    <tr key={rule.id} className="bg-emerald-950/10">
                      <td className="py-2 px-3 font-sans font-bold text-emerald-400">Static DNAT</td>
                      <td className="py-2 px-3">{rule.protocol}</td>
                      <td className="py-2 px-3 text-slate-200">
                        {rule.private_ip}:{rule.private_port}
                      </td>
                      <td className="py-2 px-3 text-emerald-300 font-bold">
                        {natPublicIp}:{rule.public_port}
                      </td>
                      <td className="py-2 px-3 text-slate-500 font-sans italic">Permanent</td>
                    </tr>
                  ))}
                  {natTable?.entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-sans text-brand-300">Dynamic SNAT</td>
                      <td className="py-2 px-3">{entry.protocol}</td>
                      <td className="py-2 px-3 text-slate-200">
                        {entry.private_ip}:{entry.private_port}
                      </td>
                      <td className="py-2 px-3 text-brand-300 font-bold">
                        {entry.public_ip}:{entry.public_port}
                      </td>
                      <td className="py-2 px-3 text-slate-400">
                        {Math.round(entry.timeout_us / 1000000)}s
                      </td>
                    </tr>
                  ))}
                  {(!natTable?.entries.length && !natTable?.static_rules.length) && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500 font-sans">
                        No active NAT sessions or static DNAT rules.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
