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


import {
  callBackend,
  isTestMode,
  liveApiRequested,
  BackendUnavailableError,
} from './apiClient';

export { checkBackendHealth, subscribeBackendStatus, getBackendStatus } from './apiClient';
export type { BackendHealth, BackendStatus } from './apiClient';

export type SimulationAuthority = 'python' | 'desktop-ipc' | 'test-double';

let authority: SimulationAuthority = 'python';

/** Which component actually executed the most recent command. */
export function getSimulationAuthority(): SimulationAuthority {
  return authority;
}

// Check if running inside Tauri window
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/**
 * Command dispatch.
 *
 *  - Inside the Tauri desktop shell the command is executed over IPC.
 *  - Inside a browser (development, preview, Playwright) the command is executed by the
 *    authoritative Python simulation service over HTTP.
 *  - Inside the unit-test runner (`vitest`) an in-memory double is used so components can be
 *    tested in isolation. This double is NEVER used in a browser: a missing backend raises
 *    `BackendUnavailableError` instead of inventing a result.
 *
 * Set `NETSIM_LIVE_API=1` when running vitest to bypass the double and exercise the real
 * Python service (see `src/integration/liveApi.test.ts`).
 */
async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const usePython = typeof window !== 'undefined' && (!isTestMode() || liveApiRequested());
  if (usePython) {
    try {
      const result = await callBackend<T>(cmd, args);
      authority = 'python';
      return result;
    } catch (err) {
      // Inside the desktop shell a native IPC compatibility layer is available. It is only
      // used when the authoritative Python service is genuinely unreachable, so the browser
      // path always fails loudly instead of silently switching engines.
      if (isTauri() && err instanceof BackendUnavailableError) {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<T>(cmd, args);
        authority = 'desktop-ipc';
        return result;
      }
      throw err;
    }
  }
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<T>(cmd, args);
    authority = 'desktop-ipc';
    return result;
  }
  authority = 'test-double';
  // The double is aliased away in every non-test build (see `vite.config.ts`).
  const { mockInvoke } = await import('@netsim/test-double');
  return mockInvoke<T>(cmd, args);
}

// Exported typed API
export const api = {
  getProject: () => invokeTauri<Project>('get_project'),
  createProject: (name: string) => invokeTauri<Project>('create_project', { name }),
  saveProjectJson: () => invokeTauri<string>('save_project_json'),
  loadProjectJson: (jsonContent: string) => invokeTauri<Project>('load_project_json', { jsonContent }),
  addNode: (label: string, nodeType: NodeType, x: number, y: number, id?: string) =>
    invokeTauri<Node>('add_node', { label, nodeType, x, y, id }),
  updateNode: (
    nodeId: string,
    label?: string,
    nodeState?: NodeState,
    position?: Position
  ) => invokeTauri<Node>('update_node', { nodeId, label, nodeState, position }),
  removeNode: (nodeId: string) => invokeTauri<void>('remove_node', { nodeId }),
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
    invokeTauri<Link>('add_link', {
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
    invokeTauri<Link>('update_link', {
      linkId,
      bandwidthBps,
      propagationDelayUs,
      lossProbability,
      bitErrorRate,
      queueCapacity,
      status,
    }),
  removeLink: (linkId: string) => invokeTauri<void>('remove_link', { linkId }),
  updateInterface: (
    nodeId: string,
    interfaceId: string,
    ipv4?: string,
    subnetMask?: string,
    ipv6?: string,
    macAddress?: string,
    status?: 'up' | 'down'
  ) =>
    invokeTauri<Interface>('update_interface', {
      nodeId,
      interfaceId,
      ipv4,
      subnetMask,
      ipv6,
      macAddress,
      status,
    }),
  undoTopology: () => invokeTauri<Project>('undo_topology'),
  redoTopology: () => invokeTauri<Project>('redo_topology'),
  getTopologyHistoryStatus: () => invokeTauri<HistoryStatus>('get_topology_history_status'),
  getSimulationState: () => invokeTauri<SimulationStateSnapshot>('get_simulation_state'),
  stepSimulation: () => invokeTauri<SimEvent | null>('step_simulation'),
  runSimulationMicros: (durationUs: number) =>
    invokeTauri<number>('run_simulation_micros', { durationUs }),
  runSimulationUntilEmpty: () => invokeTauri<number>('run_simulation_until_empty'),
  pauseSimulation: () => invokeTauri<SimulationStateSnapshot>('pause_simulation'),
  resetSimulation: () => invokeTauri<SimulationStateSnapshot>('reset_simulation'),
  injectPacket: (
    srcNodeId: string,
    dstNodeId: string,
    sizeBytes?: number,
    appProtocol?: string,
    transportProtocol?: string
  ) =>
    invokeTauri<string>('inject_packet', {
      srcNodeId,
      dstNodeId,
      sizeBytes,
      appProtocol,
      transportProtocol,
    }),
  getPacketDetails: (packetId: string) =>
    invokeTauri<Packet | null>('get_packet_details', { packetId }),
  scheduleDemoPacket: (srcNodeId: string, dstNodeId: string) =>
    invokeTauri<number>('schedule_demo_packet', { srcNodeId, dstNodeId }),
  // Phase 4A: Routing & Addressing Authoritative APIs
  calculateRoutingTable: (nodeId: string, algorithm: RoutingAlgorithm, metricType: MetricType) =>
    invokeTauri<RoutingTable>('calculate_routing_table', { nodeId, algorithm, metricType }),
  simulateRoutingConvergence: (sourceNodeId: string, metricType: MetricType) =>
    invokeTauri<ConvergenceTelemetry>('simulate_routing_convergence', { sourceNodeId, metricType }),
  calculateIpv4Subnet: (input: string) =>
    invokeTauri<Ipv4SubnetInfo>('calculate_ipv4_subnet', { input }),
  splitIpv4Subnet: (baseCidr: string, newPrefix: number) =>
    invokeTauri<SubnetSplitResult>('split_ipv4_subnet', { baseCidr, newPrefix }),
  allocateVlsmSubnets: (baseCidr: string, requirements: VlsmSubnetRequirement[]) =>
    invokeTauri<VlsmAllocationResult>('allocate_vlsm_subnets', { baseCidr, requirements }),
  detectDuplicateIps: () =>
    invokeTauri<DuplicateIpConflict[]>('detect_duplicate_ips_command'),
  validateIpv6Address: (input: string) =>
    invokeTauri<Ipv6Info>('validate_ipv6_address', { input }),
  getOrCreateNatTable: (routerNodeId: string, publicIp: string) =>
    invokeTauri<NatTable>('get_or_create_nat_table', { routerNodeId, publicIp }),
  addStaticDnatRule: (
    routerNodeId: string,
    publicIp: string,
    protocol: NatProtocol,
    publicPort: number,
    privateIp: string,
    privatePort: number,
    description: string
  ) =>
    invokeTauri<NatTable>('add_static_dnat_rule', {
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
    invokeTauri<NatTranslationResult>('simulate_nat_outbound', {
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
    invokeTauri<NatTranslationResult>('simulate_nat_inbound', {
      routerNodeId,
      publicIp,
      srcIp,
      srcPort,
      dstIp,
      dstPort,
      protocol,
    }),
  calculateHammingEncode: (dataBits: string, parityMode: ParityMode) =>
    invokeTauri<HammingEncodeResult>('calculate_hamming_encode', { dataBits, parityMode }),
  verifyAndCorrectHamming: (codeword: string, parityMode: ParityMode) =>
    invokeTauri<HammingVerifyResult>('verify_and_correct_hamming', { codeword, parityMode }),
  calculateCrc: (dataBits: string, polynomial: string, polyName?: string) =>
    invokeTauri<CrcCalculationResult>('calculate_crc', { dataBits, polynomial, polyName }),
  verifyCrc: (codeword: string, polynomial: string, polyName?: string) =>
    invokeTauri<CrcVerifyResult>('verify_crc', { codeword, polynomial, polyName }),
  calculateInternetChecksum: (inputHex: string) =>
    invokeTauri<ChecksumCalculationResult>('calculate_internet_checksum', { inputHex }),
  verifyInternetChecksum: (payloadHex: string, checksumHex: string) =>
    invokeTauri<ChecksumVerifyResult>('verify_internet_checksum', { payloadHex, checksumHex }),
  // Phase 4C: Flow Control and Multiple Access
  simulateSlidingWindow: (config: FlowControlConfig) =>
    invokeTauri<FlowControlSimResult>('simulate_sliding_window', { config }),
  simulateGoBackN: (config: FlowControlConfig) =>
    invokeTauri<FlowControlSimResult>('simulate_go_back_n', { config }),
  simulateSelectiveRepeat: (config: FlowControlConfig) =>
    invokeTauri<FlowControlSimResult>('simulate_selective_repeat', { config }),
  simulatePureAloha: (config: MacConfig) =>
    invokeTauri<MacSimResult>('simulate_pure_aloha', { config }),
  simulateSlottedAloha: (config: MacConfig) =>
    invokeTauri<MacSimResult>('simulate_slotted_aloha', { config }),
  simulateCsma: (config: MacConfig) =>
    invokeTauri<MacSimResult>('simulate_csma', { config }),
  simulateCsmaCd: (config: MacConfig) =>
    invokeTauri<MacSimResult>('simulate_csma_cd', { config }),
  // Phase 4D: Transport Layer & Congestion Control Authoritative APIs
  simulateTcp: (config: TransportConfig) =>
    invokeTauri<TransportSimResult>('simulate_tcp', { config }),
  simulateUdp: (config: TransportConfig) =>
    invokeTauri<TransportSimResult>('simulate_udp', { config }),
  simulateTcpCongestion: (config: TransportConfig) =>
    invokeTauri<TransportSimResult>('simulate_tcp_congestion', { config }),
  // Phase 6: Application Layer Protocols
  simulateDns: (config: DnsConfig) =>
    invokeTauri<DnsSimResult>('simulate_dns', { config }),
  simulateHttp: (config: HttpConfig) =>
    invokeTauri<HttpSimResult>('simulate_http', { config }),
  simulateFtp: (config: FtpConfig) =>
    invokeTauri<FtpSimResult>('simulate_ftp', { config }),
  simulateSmtp: (config: SmtpConfig) =>
    invokeTauri<SmtpSimResult>('simulate_smtp', { config }),
  simulateSnmp: (config: SnmpConfig) =>
    invokeTauri<SnmpSimResult>('simulate_snmp', { config }),
  // Phase 7: QoS Performance & Experiments
  getCurrentQosMetrics: () =>
    invokeTauri<QosMetrics>('get_current_qos_metrics'),
  scheduleFault: (entry: FaultScheduleEntry) =>
    invokeTauri<void>('schedule_fault_command', { entry }),
  runParameterSweep: (config: SweepConfig) =>
    invokeTauri<SweepExperimentResult>('run_parameter_sweep_command', { config }),
  runComparativeExperiment: (config: ComparativeExperimentConfig) =>
    invokeTauri<ComparativeExperimentResult>('run_comparative_experiment_command', { config }),
};


