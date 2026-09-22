use serde::{Deserialize, Serialize};
use std::collections::{BinaryHeap, HashMap};

use super::clock::SimTime;
use super::delays::{calculate_arrival_time_us, calculate_tx_delay_us};
use super::event::{SimEvent, SimEventType};
use super::metrics::SimulationMetrics;
use super::queue::{LinkQueue, QueueSnapshot};
use super::rng::DeterministicRng;
use crate::domain::{
    AppHeader, DataLinkHeader, EncapsulationStack, Link, NetworkHeader, Packet, PacketState,
    TransportHeader,
};
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimulationStatus {
    Ready,
    Running,
    Paused,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationStateSnapshot {
    pub current_time_us: u64,
    pub status: SimulationStatus,
    pub pending_events_count: usize,
    pub processed_events_count: usize,
    pub recent_events: Vec<SimEvent>,
    pub metrics: SimulationMetrics,
    pub queues: Vec<QueueSnapshot>,
}

pub struct SimulationEngine {
    current_time: SimTime,
    event_queue: BinaryHeap<SimEvent>,
    processed_events: Vec<SimEvent>,
    link_queues: HashMap<String, LinkQueue>,
    packets: HashMap<String, Packet>,
    metrics: SimulationMetrics,
    status: SimulationStatus,
    rng: DeterministicRng,
    next_event_id: u64,
    next_packet_id: u64,
    links_cache: HashMap<String, Link>,
}

impl SimulationEngine {
    pub fn new(seed: u64) -> Self {
        Self {
            current_time: SimTime::ZERO,
            event_queue: BinaryHeap::new(),
            processed_events: Vec::new(),
            link_queues: HashMap::new(),
            packets: HashMap::new(),
            metrics: SimulationMetrics::new(),
            status: SimulationStatus::Ready,
            rng: DeterministicRng::new(seed),
            next_event_id: 1,
            next_packet_id: 1,
            links_cache: HashMap::new(),
        }
    }

    pub fn update_links(&mut self, links: &[Link]) {
        self.links_cache.clear();
        let current_ids: std::collections::HashSet<String> =
            links.iter().map(|l| l.id.clone()).collect();
        self.link_queues.retain(|k, _| current_ids.contains(k));
        for link in links {
            self.links_cache.insert(link.id.clone(), link.clone());
            self.link_queues
                .entry(link.id.clone())
                .or_insert_with(|| LinkQueue::new(link.id.clone(), link.queue_capacity));
        }
    }

    pub fn link_queues(&self) -> &HashMap<String, LinkQueue> {
        &self.link_queues
    }

    pub fn current_time(&self) -> SimTime {
        self.current_time
    }

    pub fn status(&self) -> SimulationStatus {
        self.status
    }

    pub fn metrics(&self) -> &SimulationMetrics {
        &self.metrics
    }

    pub fn get_packet(&self, packet_id: &str) -> Option<&Packet> {
        self.packets.get(packet_id)
    }

    pub fn schedule_event(
        &mut self,
        timestamp: SimTime,
        event_type: SimEventType,
        description: String,
    ) {
        let id = self.next_event_id;
        self.next_event_id += 1;
        self.event_queue.push(SimEvent {
            id,
            timestamp,
            event_type,
            description,
        });
    }

    /// Injects a new packet into the network simulation
    pub fn inject_packet(
        &mut self,
        src_node_id: String,
        dst_node_id: String,
        size_bytes: usize,
        app_protocol: String,
        transport_protocol: String,
    ) -> String {
        let packet_id = format!("pkt-{}", self.next_packet_id);
        self.next_packet_id += 1;

        let packet = Packet {
            id: packet_id.clone(),
            src_node_id: src_node_id.clone(),
            dst_node_id: dst_node_id.clone(),
            size_bytes,
            created_at_us: self.current_time.as_micros(),
            current_node_id: src_node_id.clone(),
            next_hop_node_id: None,
            state: PacketState::Created,
            headers: EncapsulationStack {
                application: AppHeader {
                    protocol: app_protocol.clone(),
                    payload_preview: format!("Data payload ({} bytes)", size_bytes),
                },
                transport: TransportHeader {
                    protocol: transport_protocol.clone(),
                    src_port: 49152,
                    dst_port: if app_protocol == "HTTP" { 80 } else { 53 },
                    seq_num: Some(100),
                    ack_num: None,
                    window_size: Some(65535),
                    flags: if transport_protocol == "TCP" {
                        vec!["ACK".to_string()]
                    } else {
                        vec![]
                    },
                },
                network: NetworkHeader {
                    version: 4,
                    src_ip: format!("192.168.1.{}", self.next_packet_id + 10),
                    dst_ip: "10.0.0.100".to_string(),
                    ttl: 64,
                    protocol_num: if transport_protocol == "TCP" { 6 } else { 17 },
                    checksum: 0xA4F2,
                },
                datalink: DataLinkHeader {
                    src_mac: "02:00:00:00:00:01".to_string(),
                    dst_mac: "02:00:00:00:00:02".to_string(),
                    ether_type: 0x0800,
                    crc_fcs: 0x3BC1A920,
                },
            },
            journey_hops: vec![src_node_id.clone()],
        };

        self.packets.insert(packet_id.clone(), packet);
        self.metrics.record_created(size_bytes);

        // Schedule PacketCreated event
        self.schedule_event(
            self.current_time,
            SimEventType::PacketCreated {
                packet_id: packet_id.clone(),
                node_id: src_node_id.clone(),
                size_bytes,
            },
            format!(
                "Packet {} ({} bytes, {}/{}) generated at node {}",
                packet_id, size_bytes, app_protocol, transport_protocol, src_node_id
            ),
        );

        // Find candidate link from source node
        if let Some(link) = self.find_link_for_packet(&src_node_id, &dst_node_id) {
            let link_id = link.id.clone();
            let entry_time = self.current_time.add_micros(5);
            let queue_cap = link.queue_capacity;

            self.schedule_event(
                entry_time,
                SimEventType::QueueEntered {
                    packet_id: packet_id.clone(),
                    link_id: link_id.clone(),
                    queue_occupancy: self.get_queue_occupancy(&link_id),
                    queue_capacity: queue_cap,
                },
                format!("Packet {} entered queue for link {}", packet_id, link_id),
            );
        } else {
            // No link available
            self.schedule_event(
                self.current_time.add_micros(10),
                SimEventType::PacketDropped {
                    packet_id: packet_id.clone(),
                    reason: "No route or link available from node".to_string(),
                    location_id: src_node_id,
                },
                format!("Packet {} dropped: no link found", packet_id),
            );
        }

        packet_id
    }

    fn find_link_for_packet(&self, src_node_id: &str, dst_node_id: &str) -> Option<&Link> {
        // Direct link match
        for link in self.links_cache.values() {
            if (link.source.node_id == src_node_id && link.target.node_id == dst_node_id)
                || (link.target.node_id == src_node_id && link.source.node_id == dst_node_id)
            {
                return Some(link);
            }
        }
        // First hop from source
        self.links_cache
            .values()
            .find(|link| link.source.node_id == src_node_id || link.target.node_id == src_node_id)
    }

    fn get_queue_occupancy(&self, link_id: &str) -> usize {
        self.link_queues
            .get(link_id)
            .map(|q| q.occupancy())
            .unwrap_or(0)
    }

    /// Step simulation by exactly one event
    pub fn step(&mut self) -> Result<Option<SimEvent>> {
        if let Some(event) = self.event_queue.pop() {
            self.current_time = event.timestamp;
            self.process_event(&event);

            let event_clone = event.clone();
            self.processed_events.push(event);

            if self.event_queue.is_empty() {
                self.status = SimulationStatus::Completed;
            } else {
                self.status = SimulationStatus::Paused;
            }
            Ok(Some(event_clone))
        } else {
            self.status = SimulationStatus::Completed;
            Ok(None)
        }
    }

    /// Run simulation until a target virtual time is reached
    pub fn run_until(&mut self, target_time: SimTime) -> Result<usize> {
        let mut count = 0;
        self.status = SimulationStatus::Running;
        while let Some(peek_event) = self.event_queue.peek() {
            if peek_event.timestamp > target_time {
                break;
            }
            if self.step()?.is_some() {
                count += 1;
            }
        }
        if self.event_queue.is_empty() {
            self.status = SimulationStatus::Completed;
        } else {
            self.status = SimulationStatus::Paused;
        }
        Ok(count)
    }

    /// Run simulation until event queue is completely empty
    pub fn run_all(&mut self) -> Result<usize> {
        let mut count = 0;
        self.status = SimulationStatus::Running;
        while self.step()?.is_some() {
            count += 1;
        }
        self.status = SimulationStatus::Completed;
        Ok(count)
    }

    /// Pause the running simulation
    pub fn pause(&mut self) {
        if self.status == SimulationStatus::Running {
            self.status = SimulationStatus::Paused;
        }
    }

    /// Internal event handler enforcing networking invariants
    fn process_event(&mut self, event: &SimEvent) {
        match &event.event_type {
            SimEventType::PacketCreated { .. } => {
                // Handled during inject_packet
            }

            SimEventType::QueueEntered {
                packet_id, link_id, ..
            } => {
                let link = self.links_cache.get(link_id).cloned();
                if let Some(link) = link {
                    // Check if link is administratively down
                    if link.status != crate::domain::LinkStatus::Up {
                        if let Some(pkt) = self.packets.get_mut(packet_id) {
                            pkt.state = PacketState::DroppedLinkDown;
                        }
                        self.metrics.record_dropped_link_down();
                        self.schedule_event(
                            self.current_time,
                            SimEventType::PacketDropped {
                                packet_id: packet_id.clone(),
                                reason: "Link status is down".to_string(),
                                location_id: link_id.clone(),
                            },
                            format!("Packet {} dropped: link {} is down", packet_id, link_id),
                        );
                        return;
                    }

                    // Enqueue into link's FIFO queue
                    let queue = self
                        .link_queues
                        .entry(link_id.clone())
                        .or_insert_with(|| LinkQueue::new(link_id.clone(), link.queue_capacity));

                    match queue.enqueue(packet_id.clone()) {
                        Ok(()) => {
                            if let Some(pkt) = self.packets.get_mut(packet_id) {
                                pkt.state = PacketState::Queued;
                            }
                            // If link is idle, begin transmission immediately
                            if !queue.is_transmitting {
                                self.trigger_link_transmission(link_id);
                            }
                        }
                        Err(_) => {
                            // Drop-Tail: Queue is full
                            if let Some(pkt) = self.packets.get_mut(packet_id) {
                                pkt.state = PacketState::DroppedQueueFull;
                            }
                            self.metrics.record_dropped_overflow();
                            self.schedule_event(
                                self.current_time,
                                SimEventType::PacketDropped {
                                    packet_id: packet_id.clone(),
                                    reason: "Queue capacity exceeded (Drop-Tail)".to_string(),
                                    location_id: link_id.clone(),
                                },
                                format!(
                                    "Packet {} dropped: queue for link {} is full ({}/{})",
                                    packet_id, link_id, link.queue_capacity, link.queue_capacity
                                ),
                            );
                        }
                    }
                }
            }

            SimEventType::TransmissionStarted { .. } => {
                // State recorded when transmission was scheduled
            }

            SimEventType::TransmissionFinished {
                packet_id: _,
                link_id,
            } => {
                if let Some(queue) = self.link_queues.get_mut(link_id) {
                    queue.is_transmitting = false;
                }
                // If more packets are waiting in the FIFO queue, start next transmission
                self.trigger_link_transmission(link_id);
            }

            SimEventType::PacketArrived {
                packet_id,
                node_id,
                link_id: _,
            } => {
                let size_bytes = self
                    .packets
                    .get(packet_id)
                    .map(|p| p.size_bytes)
                    .unwrap_or(0);
                let created_at_us = self
                    .packets
                    .get(packet_id)
                    .map(|p| p.created_at_us)
                    .unwrap_or(0);
                let latency_us = self.current_time.as_micros().saturating_sub(created_at_us);
                let dst_node_id = self
                    .packets
                    .get(packet_id)
                    .map(|p| p.dst_node_id.clone())
                    .unwrap_or_default();

                if let Some(pkt) = self.packets.get_mut(packet_id) {
                    pkt.current_node_id = node_id.clone();
                    pkt.journey_hops.push(node_id.clone());
                }

                if node_id == &dst_node_id || dst_node_id.is_empty() {
                    if let Some(pkt) = self.packets.get_mut(packet_id) {
                        pkt.state = PacketState::Delivered;
                    }
                    self.metrics.record_delivered(size_bytes, latency_us);
                } else {
                    // Check if there is a next hop link from node_id toward destination
                    let prev_node = self.packets.get(packet_id).and_then(|p| {
                        if p.journey_hops.len() >= 2 {
                            Some(p.journey_hops[p.journey_hops.len() - 2].clone())
                        } else {
                            None
                        }
                    });

                    let next_link = self
                        .links_cache
                        .values()
                        .find(|l| {
                            (l.source.node_id == *node_id
                                && Some(&l.target.node_id) != prev_node.as_ref())
                                || (l.target.node_id == *node_id
                                    && Some(&l.source.node_id) != prev_node.as_ref())
                        })
                        .cloned();

                    if let Some(link) = next_link {
                        let link_id = link.id.clone();
                        let queue_cap = link.queue_capacity;
                        let occ = self.get_queue_occupancy(&link_id);
                        self.schedule_event(
                            self.current_time.add_micros(1),
                            SimEventType::QueueEntered {
                                packet_id: packet_id.clone(),
                                link_id: link_id.clone(),
                                queue_occupancy: occ,
                                queue_capacity: queue_cap,
                            },
                            format!(
                                "Packet {} forwarding: entered queue for link {}",
                                packet_id, link_id
                            ),
                        );
                    } else {
                        if let Some(pkt) = self.packets.get_mut(packet_id) {
                            pkt.state = PacketState::Delivered;
                        }
                        self.metrics.record_delivered(size_bytes, latency_us);
                    }
                }
            }

            SimEventType::PacketDropped { packet_id, .. } => {
                if let Some(pkt) = self.packets.get_mut(packet_id) {
                    if pkt.state != PacketState::DroppedQueueFull
                        && pkt.state != PacketState::DroppedLinkDown
                        && pkt.state != PacketState::DroppedBitError
                    {
                        pkt.state = PacketState::DroppedBitError;
                    }
                }
            }

            SimEventType::AckReceived { .. } => {}
            SimEventType::Timeout { .. } => {}
            SimEventType::Retransmission { .. } => {}
            SimEventType::RouteUpdated { .. } => {}
            SimEventType::FaultInjected { .. } => {}
        }
    }

    fn trigger_link_transmission(&mut self, link_id: &str) {
        let (next_pkt_id, link) = {
            let queue = match self.link_queues.get_mut(link_id) {
                Some(q) => q,
                None => return,
            };
            if queue.is_transmitting {
                return;
            }
            let next_pkt_id = match queue.dequeue() {
                Some(id) => id,
                None => return,
            };
            queue.is_transmitting = true;
            let link = self.links_cache.get(link_id).cloned();
            (next_pkt_id, link)
        };

        if let Some(link) = link {
            let size_bytes = self
                .packets
                .get(&next_pkt_id)
                .map(|p| p.size_bytes)
                .unwrap_or(1000);
            let tx_delay_us = calculate_tx_delay_us(size_bytes, link.bandwidth_bps);

            if let Some(pkt) = self.packets.get_mut(&next_pkt_id) {
                pkt.state = PacketState::Transmitting;
            }
            self.metrics.record_tx(size_bytes);

            // 1. Transmission Started
            self.schedule_event(
                self.current_time,
                SimEventType::TransmissionStarted {
                    packet_id: next_pkt_id.clone(),
                    link_id: link_id.to_string(),
                    tx_delay_us,
                },
                format!(
                    "Packet {} began transmission on link {} (tx_delay: {} µs)",
                    next_pkt_id, link_id, tx_delay_us
                ),
            );

            // 2. Transmission Finished
            let tx_end_time = self.current_time.add_micros(tx_delay_us);
            self.schedule_event(
                tx_end_time,
                SimEventType::TransmissionFinished {
                    packet_id: next_pkt_id.clone(),
                    link_id: link_id.to_string(),
                },
                format!(
                    "Packet {} completed transmission onto link {}",
                    next_pkt_id, link_id
                ),
            );

            // 3. Propagation & Arrival or Loss
            let arrival_time_us = calculate_arrival_time_us(
                self.current_time.as_micros(),
                tx_delay_us,
                link.propagation_delay_us,
            );
            let arrival_time = SimTime::from_micros(arrival_time_us);

            // Stochastic link loss check using deterministic RNG
            let is_lost = self.rng.gen_bool(link.loss_probability);
            let is_bit_error = self.rng.gen_bool(link.bit_error_rate);

            if is_lost {
                self.metrics.record_dropped_loss();
                self.schedule_event(
                    arrival_time,
                    SimEventType::PacketDropped {
                        packet_id: next_pkt_id.clone(),
                        reason: "Stochastic packet loss on link".to_string(),
                        location_id: link_id.to_string(),
                    },
                    format!(
                        "Packet {} dropped in transit on link {} (loss rate: {:.1}%)",
                        next_pkt_id,
                        link_id,
                        link.loss_probability * 100.0
                    ),
                );
            } else if is_bit_error {
                self.metrics.record_dropped_error();
                self.schedule_event(
                    arrival_time,
                    SimEventType::PacketDropped {
                        packet_id: next_pkt_id.clone(),
                        reason: "CRC FCS frame check error (bit corruption)".to_string(),
                        location_id: link_id.to_string(),
                    },
                    format!(
                        "Packet {} corrupted by bit errors on link {}",
                        next_pkt_id, link_id
                    ),
                );
            } else {
                let target_node = if let Some(pkt) = self.packets.get(&next_pkt_id) {
                    if pkt.current_node_id == link.source.node_id {
                        link.target.node_id.clone()
                    } else {
                        link.source.node_id.clone()
                    }
                } else {
                    link.target.node_id.clone()
                };

                self.schedule_event(
                    arrival_time,
                    SimEventType::PacketArrived {
                        packet_id: next_pkt_id.clone(),
                        node_id: target_node.clone(),
                        link_id: link_id.to_string(),
                    },
                    format!(
                        "Packet {} arrived at node {} via link {}",
                        next_pkt_id, target_node, link_id
                    ),
                );
            }
        }
    }

    /// Reset simulation state back to time 0 with reseeded PRNG
    pub fn reset(&mut self, seed: u64) {
        self.current_time = SimTime::ZERO;
        self.event_queue.clear();
        self.processed_events.clear();
        self.packets.clear();
        for q in self.link_queues.values_mut() {
            q.reset();
        }
        self.metrics.reset();
        self.status = SimulationStatus::Ready;
        self.rng.reseed(seed);
        self.next_event_id = 1;
        self.next_packet_id = 1;
    }

    pub fn get_snapshot(&self) -> SimulationStateSnapshot {
        let recent = self
            .processed_events
            .iter()
            .rev()
            .take(50)
            .cloned()
            .collect();
        let queues = self
            .link_queues
            .values()
            .map(|q| q.get_snapshot())
            .collect();
        SimulationStateSnapshot {
            current_time_us: self.current_time.as_micros(),
            status: self.status,
            pending_events_count: self.event_queue.len(),
            processed_events_count: self.processed_events.len(),
            recent_events: recent,
            metrics: self.metrics.clone(),
            queues,
        }
    }
}
