import { Node, Link } from './topology';

export interface ProjectMetadata {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  author: string;
}

export interface SimulationConfig {
  seed: number;
  max_simulation_time_us: number;
  default_bandwidth_bps: number;
  default_propagation_delay_us: number;
}

export interface Project {
  schemaVersion: number;
  metadata: ProjectMetadata;
  nodes: Node[];
  links: Link[];
  simulation_config: SimulationConfig;
}
