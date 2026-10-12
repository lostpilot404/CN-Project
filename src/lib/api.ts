/**
 * The NetSim front-end's typed command surface.
 *
 * Python is the sole simulation authority: every command in this module is executed by the
 * simulation service in `python/netsim/server.py`, and the results are rendered exactly as they
 * are returned. The front-end contains no second engine and no fallback that could fabricate a
 * simulation result -- an unreachable backend surfaces an error to the user instead.
 *
 * Transport details (endpoint resolution, health probing, retries) live in `./apiClient`.
 */
import { Project } from '../types/project';
import {
  Node,
  NodeType,
  NodeState,
  Position,
  Link,
  LinkStatus,
  Interface,
  HistoryStatus,
} from '../types/topology';
import { SimulationStateSnapshot, SimEvent, Packet } from '../types/simulation';
import {
  MetricType,
  RoutingAlgorithm,
  RoutingTable,
  ConvergenceTelemetry,
} from '../types/routing';
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
} from '../types/addressing';
import {
  ParityMode,
  HammingEncodeResult,
  HammingVerifyResult,
  CrcCalculationResult,
  CrcVerifyResult,
  ChecksumCalculationResult,
  ChecksumVerifyResult,
} from '../types/datalink';
import {
  FlowControlConfig,
  FlowControlSimResult,
} from '../types/flowControl';
import {
  MacConfig,
  MacSimResult,
} from '../types/mac';
import {
  TransportConfig,
  TransportSimResult,
} from '../types/transport';
import {
  DnsConfig,
  DnsSimResult,
  HttpConfig,
  HttpSimResult,
  FtpConfig,
  FtpSimResult,
  SmtpConfig,
  SmtpSimResult,
  SnmpConfig,
  SnmpSimResult,
} from '../types/application';
import {
  QosMetrics,
  FaultScheduleEntry,
  SweepConfig,
  SweepExperimentResult,
  ComparativeExperimentConfig,
  ComparativeExperimentResult,
} from '../types/experiments';


import { callBackend, isTestMode, liveApiRequested } from './apiClient';

export { checkBackendHealth, subscribeBackendStatus, getBackendStatus } from './apiClient';
export type { BackendHealth, BackendStatus } from './apiClient';

export type SimulationAuthority = 'python' | 'test-double';

let authority: SimulationAuthority = 'python';

/** Which component actually executed the most recent command. */
export function getSimulationAuthority(): SimulationAuthority {
  return authority;
}

/**
 * Command dispatch.
 *
 *  - In a browser (development, preview, Playwright) the command is executed by the authoritative
 *    Python simulation service over HTTP. This is the production path.
 *  - In the unit-test runner (`vitest`) an in-memory double is used so components can be tested in
 *    isolation. That double is aliased away in every other build (see `vite.config.ts`) and is
 *    never reachable from a browser: an unreachable backend raises `BackendUnavailableError`
 *    instead of inventing a result.
 *
 * Set `NETSIM_LIVE_API=1` when running vitest to bypass the double and exercise the real Python
 * service (see `src/integration/liveApi.test.ts`).
 */
async function callCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window !== 'undefined' && (!isTestMode() || liveApiRequested())) {
    const result = await callBackend<T>(cmd, args);
    authority = 'python';
    return result;
  }
  authority = 'test-double';
  const { mockInvoke } = await import('@netsim/test-double');
  return mockInvoke<T>(cmd, args);
}

// Exported typed API
export const api = {
  getProject: () => callCommand<Project>('get_project'),
  createProject: (name: string) => callCommand<Project>('create_project', { name }),
  saveProjectJson: () => callCommand<string>('save_project_json'),
  loadProjectJson: (jsonContent: string) => callCommand<Project>('load_project_json', { jsonContent }),
  addNode: (label: string, nodeType: NodeType, x: number, y: number, id?: string) =>
    callCommand<Node>('add_node', { label, nodeType, x, y, id }),
  updateNode: (
    nodeId: string,
    label?: string,
    nodeState?: NodeState,
    position?: Position
  ) => callCommand<Node>('update_node', { nodeId, label, nodeState, position }),
  removeNode: (nodeId: string) => callCommand<void>('remove_node', { nodeId }),
  addLink: (
    sourceNodeId: string,
    targetNodeId: string,
    id?: string,
    sourceInterfaceId?: string,
    targetInterfaceId?: string,
    bandwidthBps?: number,
    propagationDelayUs?: number,
    lossProbability?: number,
    bitErrorRate?: number,
    queueCapacity?: number
  ) =>
    callCommand<Link>('add_link', {
      sourceNodeId,
      targetNodeId,
      id,
      sourceInterfaceId,
      targetInterfaceId,
      bandwidthBps,
      propagationDelayUs,
      lossProbability,
      bitErrorRate,
      queueCapacity,
    }),
  updateLink: (
    linkId: string,
    bandwidthBps?: number,
    propagationDelayUs?: number,
    lossProbability?: number,
    bitErrorRate?: number,
    queueCapacity?: number,
    status?: LinkStatus
  ) =>
    callCommand<Link>('update_link', {
      linkId,
      bandwidthBps,
      propagationDelayUs,
      lossProbability,
      bitErrorRate,
      queueCapacity,
      status,
    }),
  removeLink: (linkId: string) => callCommand<void>('remove_link', { linkId }),
  updateInterface: (
    nodeId: string,
    interfaceId: string,
    ipv4?: string,
    subnetMask?: string,
    ipv6?: string,
    macAddress?: string,
    status?: 'up' | 'down'
  ) =>
    callCommand<Interface>('update_interface', {
      nodeId,
      interfaceId,
      ipv4,
      subnetMask,
      ipv6,
      macAddress,
      status,
    }),
  undoTopology: () => callCommand<Project>('undo_topology'),
  redoTopology: () => callCommand<Project>('redo_topology'),
  getTopologyHistoryStatus: () => callCommand<HistoryStatus>('get_topology_history_status'),
  getSimulationState: () => callCommand<SimulationStateSnapshot>('get_simulation_state'),
  stepSimulation: () => callCommand<SimEvent | null>('step_simulation'),
  runSimulationMicros: (durationUs: number) =>
    callCommand<number>('run_simulation_micros', { durationUs }),
  runSimulationUntilEmpty: () => callCommand<number>('run_simulation_until_empty'),
  pauseSimulation: () => callCommand<SimulationStateSnapshot>('pause_simulation'),
  resetSimulation: () => callCommand<SimulationStateSnapshot>('reset_simulation'),
  injectPacket: (
    srcNodeId: string,
    dstNodeId: string,
    sizeBytes?: number,
    appProtocol?: string,
    transportProtocol?: string
  ) =>
    callCommand<string>('inject_packet', {
      srcNodeId,
      dstNodeId,
      sizeBytes,
      appProtocol,
      transportProtocol,
    }),
  getPacketDetails: (packetId: string) =>
    callCommand<Packet | null>('get_packet_details', { packetId }),
  scheduleDemoPacket: (srcNodeId: string, dstNodeId: string) =>
    callCommand<number>('schedule_demo_packet', { srcNodeId, dstNodeId }),
  // Phase 4A: Routing & Addressing Authoritative APIs
  calculateRoutingTable: (nodeId: string, algorithm: RoutingAlgorithm, metricType: MetricType) =>
    callCommand<RoutingTable>('calculate_routing_table', { nodeId, algorithm, metricType }),
  simulateRoutingConvergence: (sourceNodeId: string, metricType: MetricType) =>
    callCommand<ConvergenceTelemetry>('simulate_routing_convergence', { sourceNodeId, metricType }),
  calculateIpv4Subnet: (input: string) =>
    callCommand<Ipv4SubnetInfo>('calculate_ipv4_subnet', { input }),
  splitIpv4Subnet: (baseCidr: string, newPrefix: number) =>
    callCommand<SubnetSplitResult>('split_ipv4_subnet', { baseCidr, newPrefix }),
  allocateVlsmSubnets: (baseCidr: string, requirements: VlsmSubnetRequirement[]) =>
    callCommand<VlsmAllocationResult>('allocate_vlsm_subnets', { baseCidr, requirements }),
  detectDuplicateIps: () =>
    callCommand<DuplicateIpConflict[]>('detect_duplicate_ips_command'),
  validateIpv6Address: (input: string) =>
    callCommand<Ipv6Info>('validate_ipv6_address', { input }),
  getOrCreateNatTable: (routerNodeId: string, publicIp: string) =>
    callCommand<NatTable>('get_or_create_nat_table', { routerNodeId, publicIp }),
  addStaticDnatRule: (
    routerNodeId: string,
    publicIp: string,
    protocol: NatProtocol,
    publicPort: number,
    privateIp: string,
    privatePort: number,
    description: string
  ) =>
    callCommand<NatTable>('add_static_dnat_rule', {
      routerNodeId,
      publicIp,
      protocol,
      publicPort,
      privateIp,
      privatePort,
      description,
    }),
  simulateNatOutbound: (
    routerNodeId: string,
    publicIp: string,
    srcIp: string,
    srcPort: number,
    dstIp: string,
    dstPort: number,
    protocol: NatProtocol
  ) =>
    callCommand<NatTranslationResult>('simulate_nat_outbound', {
      routerNodeId,
      publicIp,
      srcIp,
      srcPort,
      dstIp,
      dstPort,
      protocol,
    }),
  simulateNatInbound: (
    routerNodeId: string,
    publicIp: string,
    srcIp: string,
    srcPort: number,
    dstIp: string,
    dstPort: number,
    protocol: NatProtocol
  ) =>
    callCommand<NatTranslationResult>('simulate_nat_inbound', {
      routerNodeId,
      publicIp,
      srcIp,
      srcPort,
      dstIp,
      dstPort,
      protocol,
    }),
  calculateHammingEncode: (dataBits: string, parityMode: ParityMode) =>
    callCommand<HammingEncodeResult>('calculate_hamming_encode', { dataBits, parityMode }),
  verifyAndCorrectHamming: (codeword: string, parityMode: ParityMode) =>
    callCommand<HammingVerifyResult>('verify_and_correct_hamming', { codeword, parityMode }),
  calculateCrc: (dataBits: string, polynomial: string, polyName?: string) =>
    callCommand<CrcCalculationResult>('calculate_crc', { dataBits, polynomial, polyName }),
  verifyCrc: (codeword: string, polynomial: string, polyName?: string) =>
    callCommand<CrcVerifyResult>('verify_crc', { codeword, polynomial, polyName }),
  calculateInternetChecksum: (inputHex: string) =>
    callCommand<ChecksumCalculationResult>('calculate_internet_checksum', { inputHex }),
  verifyInternetChecksum: (payloadHex: string, checksumHex: string) =>
    callCommand<ChecksumVerifyResult>('verify_internet_checksum', { payloadHex, checksumHex }),
  // Phase 4C: Flow Control and Multiple Access
  simulateSlidingWindow: (config: FlowControlConfig) =>
    callCommand<FlowControlSimResult>('simulate_sliding_window', { config }),
  simulateGoBackN: (config: FlowControlConfig) =>
    callCommand<FlowControlSimResult>('simulate_go_back_n', { config }),
  simulateSelectiveRepeat: (config: FlowControlConfig) =>
    callCommand<FlowControlSimResult>('simulate_selective_repeat', { config }),
  simulatePureAloha: (config: MacConfig) =>
    callCommand<MacSimResult>('simulate_pure_aloha', { config }),
  simulateSlottedAloha: (config: MacConfig) =>
    callCommand<MacSimResult>('simulate_slotted_aloha', { config }),
  simulateCsma: (config: MacConfig) =>
    callCommand<MacSimResult>('simulate_csma', { config }),
  simulateCsmaCd: (config: MacConfig) =>
    callCommand<MacSimResult>('simulate_csma_cd', { config }),
  // Phase 4D: Transport Layer & Congestion Control Authoritative APIs
  simulateTcp: (config: TransportConfig) =>
    callCommand<TransportSimResult>('simulate_tcp', { config }),
  simulateUdp: (config: TransportConfig) =>
    callCommand<TransportSimResult>('simulate_udp', { config }),
  simulateTcpCongestion: (config: TransportConfig) =>
    callCommand<TransportSimResult>('simulate_tcp_congestion', { config }),
  // Phase 6: Application Layer Protocols
  simulateDns: (config: DnsConfig) =>
    callCommand<DnsSimResult>('simulate_dns', { config }),
  simulateHttp: (config: HttpConfig) =>
    callCommand<HttpSimResult>('simulate_http', { config }),
  simulateFtp: (config: FtpConfig) =>
    callCommand<FtpSimResult>('simulate_ftp', { config }),
  simulateSmtp: (config: SmtpConfig) =>
    callCommand<SmtpSimResult>('simulate_smtp', { config }),
  simulateSnmp: (config: SnmpConfig) =>
    callCommand<SnmpSimResult>('simulate_snmp', { config }),
  // Phase 7: QoS Performance & Experiments
  getCurrentQosMetrics: () =>
    callCommand<QosMetrics>('get_current_qos_metrics'),
  scheduleFault: (entry: FaultScheduleEntry) =>
    callCommand<void>('schedule_fault_command', { entry }),
  runParameterSweep: (config: SweepConfig) =>
    callCommand<SweepExperimentResult>('run_parameter_sweep_command', { config }),
  runComparativeExperiment: (config: ComparativeExperimentConfig) =>
    callCommand<ComparativeExperimentResult>('run_comparative_experiment_command', { config }),
};


