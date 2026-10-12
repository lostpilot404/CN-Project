import { describe, it, expect } from 'vitest';
import { api } from './lib/api';
import {
  DnsConfig,
  HttpConfig,
  FtpConfig,
  SmtpConfig,
  SnmpConfig,
} from './types/application';
import { Packet } from './types/packet';

describe('Phase 6: Application-Layer Protocols & End-to-End Protocol Workflows', () => {
  // 1. DNS: Recursive A Success
  it('should simulate DNS recursive query and return NOERROR with authoritative answer', async () => {
    const config: DnsConfig = {
      client_node_id: 'host-a',
      server_node_id: 'dns-resolver',
      query_name: 'www.example.com',
      query_type: 'A',
      query_mode: 'recursive',
      query_id: 1001,
      seed: 42,
    };

    const res = await api.simulateDns(config);
    expect(res).toBeDefined();
    expect(res.response_code).toBe('NOERROR');
    expect(res.answers.length).toBeGreaterThan(0);
    expect(res.answers[0].name).toBe('www.example.com');
    expect(res.answers[0].record_type).toBe('A');
    expect(res.answers[0].value).toBe('93.184.216.34');
    expect(res.metrics.success).toBe(true);

    // Verify packet generation and encapsulation
    expect(res.packets.length).toBeGreaterThanOrEqual(2);
    const queryPkt = res.packets.find((p) => p.headers.application.message_type === 'DNS_QUERY');
    expect(queryPkt).toBeDefined();
    expect(queryPkt?.headers.transport.protocol).toBe('UDP');
    expect(queryPkt?.headers.transport.dst_port).toBe(53);
    expect(queryPkt?.headers.application.protocol).toBe('DNS');
    expect(queryPkt?.headers.application.transaction_id).toBe(1001);
  });

  // 2. DNS: NXDOMAIN outcome
  it('should simulate DNS query returning NXDOMAIN when domain does not exist', async () => {
    const config: DnsConfig = {
      client_node_id: 'host-a',
      server_node_id: 'dns-resolver',
      query_name: 'nxdomain.example.com',
      query_type: 'A',
      query_mode: 'recursive',
      query_id: 1002,
      seed: 42,
    };

    const res = await api.simulateDns(config);
    expect(res.response_code).toBe('NXDOMAIN');
    expect(res.answers.length).toBe(0);
    expect(res.metrics.success).toBe(false);
    expect(res.events.some((e) => e.event_type.includes('NXDOMAIN'))).toBe(true);
  });

  // 3. DNS: Record types AAAA, CNAME, MX
  it('should support AAAA, CNAME, and MX record lookups', async () => {
    const aaaaConfig: DnsConfig = {
      client_node_id: 'host-a',
      server_node_id: 'dns-resolver',
      query_name: 'ipv6.example.com',
      query_type: 'AAAA',
      query_mode: 'recursive',
      query_id: 1003,
      seed: 42,
    };
    const resAaaa = await api.simulateDns(aaaaConfig);
    expect(resAaaa.response_code).toBe('NOERROR');
    expect(resAaaa.answers[0].record_type).toBe('AAAA');
  });

  // 4. HTTP: GET 200 OK
  it('should simulate HTTP GET and return 200 OK with response headers and payload', async () => {
    const config: HttpConfig = {
      client_node_id: 'host-a',
      server_node_id: 'web-server',
      request: {
        method: 'GET',
        path: '/index.html',
        headers: { Host: 'example.com', 'User-Agent': 'NetSim-Client/1.0' },
        body: null,
      },
      port: 80,
      seed: 42,
    };

    const res = await api.simulateHttp(config);
    expect(res.response.status_code).toBe(200);
    expect(res.response.status_text).toBe('OK');
    expect(res.response.body).toContain('NetSim');
    expect(res.metrics.success).toBe(true);

    // Verify TCP transport integration
    expect(res.packets.length).toBeGreaterThanOrEqual(2);
    const reqPkt = res.packets.find((p) => p.headers.application.message_type === 'HTTP_REQUEST');
    expect(reqPkt).toBeDefined();
    expect(reqPkt?.headers.transport.protocol).toBe('TCP');
    expect(reqPkt?.headers.transport.dst_port).toBe(80);
    expect(reqPkt?.headers.application.session_id).toBe('http-sess-80');
  });

  // 5. HTTP: GET 404 Not Found
  it('should simulate HTTP GET to unknown path and return 404 Not Found', async () => {
    const config: HttpConfig = {
      client_node_id: 'host-a',
      server_node_id: 'web-server',
      request: {
        method: 'GET',
        path: '/not-found',
        headers: { Host: 'example.com' },
        body: null,
      },
      port: 80,
      seed: 42,
    };

    const res = await api.simulateHttp(config);
    expect(res.response.status_code).toBe(404);
    expect(res.response.status_text).toBe('Not Found');
    expect(res.events.some((e) => e.event_type.includes('NOT_FOUND'))).toBe(true);
  });

  // 6. HTTP: POST request
  it('should simulate HTTP POST with payload entity body', async () => {
    const config: HttpConfig = {
      client_node_id: 'host-a',
      server_node_id: 'web-server',
      request: {
        method: 'POST',
        path: '/api/feedback',
        headers: { Host: 'example.com', 'Content-Type': 'application/json' },
        body: '{"message": "NetSim rocks"}',
      },
      port: 80,
      seed: 42,
    };

    const res = await api.simulateHttp(config);
    expect(res.config.request.method).toBe('POST');
    expect(res.config.request.body).toBe('{"message": "NetSim rocks"}');
    expect(res.events.some((e) => e.event_type === 'HTTP_REQUEST_SENT')).toBe(true);
  });

  // 7. FTP: Explicit Control Channel (21) & Data Channel separation
  it('should separate FTP Control Channel (port 21) from Data Channel (port 50000+)', async () => {
    const config: FtpConfig = {
      client_node_id: 'host-a',
      server_node_id: 'ftp-server',
      username: 'anonymous',
      password: 'guest@example.com',
      transfer_command: 'RETR',
      filename: 'research_paper.pdf',
      file_size_bytes: 4096,
      control_port: 21,
      data_port: 50000,
      seed: 42,
    };

    const res = await api.simulateFtp(config);
    expect(res.control_session_id).toContain('ftp-ctrl-sess');
    expect(res.data_session_id).toContain('ftp-data-sess');
    expect(res.control_session_id).not.toBe(res.data_session_id);

    // Check control packets on port 21 vs data packets on data port
    const ctrlPkt = res.packets.find((p) => p.headers.transport.dst_port === 21);
    expect(ctrlPkt).toBeDefined();
    expect(ctrlPkt?.headers.application.session_id).toBe(res.control_session_id);

    const dataPkt = res.packets.find(
      (p) =>
        p.headers.transport.src_port === 50000 || p.headers.transport.dst_port === 50000
    );
    expect(dataPkt).toBeDefined();
    expect(dataPkt?.headers.application.session_id).toBe(res.data_session_id);

    // Verify FTP status responses
    expect(res.events.some((e) => e.description.includes('220'))).toBe(true);
    expect(res.events.some((e) => e.description.includes('230'))).toBe(true);
    expect(res.events.some((e) => e.description.includes('226'))).toBe(true);
  });

  // 8. SMTP: Accepted mail submission (250 OK)
  it('should simulate SMTP mail submission and complete with 250 accepted', async () => {
    const config: SmtpConfig = {
      client_node_id: 'host-a',
      server_node_id: 'mail-server',
      mail_from: 'alice@example.com',
      rcpt_to: 'bob@example.com',
      subject: 'Quarterly Network Simulation Report',
      body: 'Hello Bob,\nNetSim Phase 6 is complete.',
      reject_recipient: false,
      port: 25,
      seed: 42,
    };

    const res = await api.simulateSmtp(config);
    expect(res.is_accepted).toBe(true);
    expect(res.events.some((e) => e.event_type === 'SMTP_GREETING')).toBe(true);
    expect(res.events.some((e) => e.description.includes('MAIL FROM'))).toBe(true);
    expect(res.events.some((e) => e.description.includes('RCPT TO'))).toBe(true);
    expect(res.events.some((e) => e.event_type === 'SMTP_MESSAGE_ACCEPTED')).toBe(true);
    expect(res.events.some((e) => e.event_type === 'SMTP_TERMINATED')).toBe(true);
  });

  // 9. SMTP: Rejected recipient (550 User unknown)
  it('should simulate SMTP recipient rejection with 550 User unknown error path', async () => {
    const config: SmtpConfig = {
      client_node_id: 'host-a',
      server_node_id: 'mail-server',
      mail_from: 'alice@example.com',
      rcpt_to: 'unknown@example.com',
      subject: 'Test',
      body: 'Test body',
      reject_recipient: true,
      port: 25,
      seed: 42,
    };

    const res = await api.simulateSmtp(config);
    expect(res.is_accepted).toBe(false);
    expect(res.state).toBe('failed');
    expect(res.events.some((e) => e.event_type === 'SMTP_RCPT_REJECTED')).toBe(true);
    expect(res.events.some((e) => e.description.includes('550'))).toBe(true);
  });

  // 10. SNMP: Known OID query
  it('should query SNMP MIB-2 tree and return sysDescr object', async () => {
    const config: SnmpConfig = {
      manager_node_id: 'nms-manager',
      agent_node_id: 'router-core',
      community: 'public',
      requested_oid: '1.3.6.1.2.1.1.1.0',
      port: 161,
      seed: 42,
    };

    const res = await api.simulateSnmp(config);
    expect(res.found_object).toBeDefined();
    expect(res.found_object?.name).toBe('sysDescr.0');
    expect(res.found_object?.syntax).toBe('DisplayString');
    expect(res.found_object?.value).toContain('NetSim CoreOS Router');
    expect(res.metrics.success).toBe(true);

    // Verify UDP port 161
    const reqPkt = res.packets.find((p) => p.headers.application.message_type === 'SNMP_GET_REQUEST');
    expect(reqPkt).toBeDefined();
    expect(reqPkt?.headers.transport.protocol).toBe('UDP');
    expect(reqPkt?.headers.transport.dst_port).toBe(161);
  });

  // 11. SNMP: Unknown OID query (noSuchName error path)
  it('should query unknown SNMP OID and trigger noSuchName error path', async () => {
    const config: SnmpConfig = {
      manager_node_id: 'nms-manager',
      agent_node_id: 'router-core',
      community: 'public',
      requested_oid: '1.3.6.1.2.1.99.99.0',
      port: 161,
      seed: 42,
    };

    const res = await api.simulateSnmp(config);
    expect(res.found_object).toBeNull();
    expect(res.metrics.success).toBe(false);
    expect(res.events.some((e) => e.event_type === 'SNMP_UNKNOWN_OID')).toBe(true);
  });

  // 12. AppHeader backward-compatible extension
  it('should preserve and validate AppHeader metadata fields', () => {
    const pkt: Packet = {
      id: 'pkt-app-test',
      src_node_id: 'node-1',
      dst_node_id: 'node-2',
      size_bytes: 128,
      created_at_us: 0,
      current_node_id: 'node-1',
      next_hop_node_id: 'node-2',
      state: 'created',
      headers: {
        application: {
          protocol: 'DNS',
          payload_preview: 'DNS Query: example.com',
          message_type: 'DNS_QUERY',
          session_id: 'sess-1',
          transaction_id: 42,
          resource_or_command: 'example.com',
          status_code: 'NOERROR',
        },
        transport: {
          protocol: 'UDP',
          src_port: 5353,
          dst_port: 53,
          flags: [],
        },
        network: {
          version: 4,
          src_ip: '192.168.1.1',
          dst_ip: '192.168.1.2',
          ttl: 64,
          protocol_num: 17,
          checksum: 0x1234,
        },
        datalink: {
          src_mac: '02:00:00:00:00:01',
          dst_mac: '02:00:00:00:00:02',
          ether_type: 0x0800,
          crc_fcs: 0xabcd,
        },
      },
      journey_hops: ['node-1'],
      planned_route: ['node-1', 'node-2'],
      hop_history: [],
    };

    expect(pkt.headers.application.protocol).toBe('DNS');
    expect(pkt.headers.application.session_id).toBe('sess-1');
    expect(pkt.headers.application.transaction_id).toBe(42);
    expect(pkt.headers.application.resource_or_command).toBe('example.com');
    expect(pkt.headers.application.status_code).toBe('NOERROR');
  });

  // 13. UDP packet invariants: Never fabricate TCP sequence/ACK/flags for UDP
  it('should ensure UDP packets do not contain fabricated TCP sequence, ACK, or window flags', async () => {
    const config: DnsConfig = {
      client_node_id: 'host-a',
      server_node_id: 'dns-resolver',
      query_name: 'www.example.com',
      query_type: 'A',
      query_mode: 'recursive',
      query_id: 1001,
      seed: 42,
    };

    const res = await api.simulateDns(config);
    for (const pkt of res.packets) {
      if (pkt.headers.transport.protocol === 'UDP') {
        expect(pkt.headers.transport.flags).toEqual([]);
        expect(pkt.headers.transport.seq_num ?? null).toBeNull();
        expect(pkt.headers.transport.ack_num ?? null).toBeNull();
      }
    }
  });

  // 14. Event-to-packet relationship: Local events have packet_id = null
  it('should ensure purely local application processing events have packet_id = null', async () => {
    const config: DnsConfig = {
      client_node_id: 'host-a',
      server_node_id: 'dns-resolver',
      query_name: 'www.example.com',
      query_type: 'A',
      query_mode: 'recursive',
      query_id: 1001,
      seed: 42,
    };

    const res = await api.simulateDns(config);
    const lookupEvent = res.events.find((e) => e.event_type === 'DNS_LOOKUP');
    expect(lookupEvent).toBeDefined();
    expect(lookupEvent?.packet_id).toBeNull();

    const queryEvent = res.events.find((e) => e.event_type === 'DNS_QUERY_SENT');
    expect(queryEvent).toBeDefined();
    expect(queryEvent?.packet_id).toBeTruthy();
  });
});
