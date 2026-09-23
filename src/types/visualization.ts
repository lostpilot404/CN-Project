// Visualization, Encapsulation, and Topology Synchronization DTOs
import { PacketState } from './packet';

export interface PacketJourneyHop {
  hopIndex: number;
  nodeId: string;
  linkId?: string | null;
  timestamp_us: number;
  state: PacketState;
  description: string;
  isCurrent: boolean;
  isTraversed: boolean;
}

export interface PacketJourney {
  packetId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  currentState: PacketState;
  actualHops: PacketJourneyHop[];
  plannedRoute: string[];
  totalLatencyUs: number;
}

export type EncapsulationMode = 'encapsulation' | 'decapsulation';

export interface TopologySyncState {
  focusedNodeId: string | null;
  focusedLinkId: string | null;
  selectedPacketId: string | null;
  selectedEventId: number | null;
}
