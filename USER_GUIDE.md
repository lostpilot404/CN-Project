# NetSim --- User Guide

## 1. Launch

Open the NetSim desktop application.

The dashboard provides:

-   New Project
-   Open Project
-   Demo Scenarios
-   Experiments
-   Learning Mode
-   Exam Mode

## 2. Create a Project

Select **New Project**.

Enter a project name and choose an optional template.

## 3. Build a Topology

Open **Topology**.

Drag devices onto the canvas:

-   PC
-   Server
-   Router
-   Switch
-   Wireless Access Point

Connect devices with links.

## 4. Configure a Link

Select a link.

Set:

-   bandwidth
-   latency
-   packet loss
-   bit-error rate
-   queue size
-   status

## 5. Configure an Interface

Select a node and interface.

Enter:

-   IPv4 address
-   CIDR/subnet mask
-   optional IPv6 address

Invalid values are rejected.

## 6. Routing

Open **Routing**.

Choose:

-   Link State
-   Distance Vector

Run the calculation.

Inspect:

-   routing tables
-   path
-   next hop
-   cost
-   hop count
-   route changes

## 7. Send a Packet

Choose:

-   source
-   destination
-   protocol
-   packet size
-   packet count

Press **Run**.

## 8. Simulation Controls

Controls:

-   Run
-   Pause
-   Resume
-   Stop
-   Reset
-   Next Event
-   Speed

Speed options should control UI animation, not alter simulation time
semantics.

## 9. Packet Inspector

Click a packet.

Inspect:

-   application data
-   transport header
-   network header
-   data-link frame
-   source
-   destination
-   sequence
-   TTL
-   state
-   route
-   timestamps

## 10. Event Timeline

Open the event timeline.

Events include:

-   packet creation
-   queueing
-   transmission
-   arrival
-   loss
-   ACK
-   timeout
-   retransmission
-   route changes

Selecting an event should highlight related objects.

## 11. Error Control

Open **Error Control**.

Choose:

-   Hamming
-   CRC
-   Checksum

Enter data and optionally inject an error.

Inspect intermediate calculations.

## 12. Flow Control

Choose:

-   Sliding Window
-   Go-Back-N
-   Selective Repeat

Configure:

-   window size
-   packet count
-   loss
-   delay

Run and inspect ACK/retransmission behavior.

## 13. TCP/UDP

Open **Transport**.

Choose TCP or UDP.

Inspect:

-   sequence numbers
-   ACKs
-   RTT
-   retransmissions
-   throughput
-   loss

## 14. Fault Injection

Open **Faults**.

Choose:

-   packet loss
-   bit error
-   link failure
-   router failure
-   queue overflow
-   latency change
-   bandwidth reduction

Run the simulation and inspect the result.

## 15. Experiments

Create a parameterized experiment.

Example:

``` text
TCP performance

Packet loss:
0, 2, 5, 10, 20%

Packets:
100

Bandwidth:
10 Mbps

Latency:
30 ms
```

Run all configurations.

## 16. Comparison

Compare measured results.

Do not interpret the chart as an automatic universal ranking; it
represents the selected simulation conditions.

## 17. Learning Mode

Learning Mode explains each algorithm step.

Use it for:

-   routing
-   CRC
-   Hamming
-   flow control
-   congestion

## 18. Exam Mode

Exam Mode provides controlled exercises.

The application should evaluate configured network states and show
whether the submitted solution satisfies the exercise.

## 19. Save

Use **Save Project**.

Project files should be versioned and portable.

## 20. Reports

Select an experiment and choose **Generate Report**.

Reports contain:

-   objective
-   configuration
-   methodology
-   results
-   charts
-   observations

## 21. Python Toolkit

Python is optional.

Export experiment data from NetSim and analyze it with the Python
toolkit.

Python is not required to launch NetSim or run ordinary simulations.
