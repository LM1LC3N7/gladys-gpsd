# gpsd

Shows in Gladys the position of a GPS / GNSS receiver shared by
[gpsd](https://gpsd.io): a camper van, a boat, a cabin, a weather mast. gpsd
reads the receiver (USB or serial) on its own machine and shares its reports on
the network; this integration connects to it over TCP and reads them. It never
touches USB nor a serial port, and never sends anything to the receiver.

> This integration has never been tested with a real receiver: it was tested
> with gpsd 3.25 and `gpsfake` replaying an NMEA log. Feedback is welcome.

## What you get

One device per gpsd address (Discovery tab), read only:

| Feature          | Unit / values                                            |
| ---------------- | -------------------------------------------------------- |
| Latitude         | degrees, rounded (see Precision)                         |
| Longitude        | degrees, rounded (see Precision)                         |
| Speed            | km/h, to 0.1                                             |
| Altitude         | metres above sea level, 3D fix only                      |
| Course           | degrees from true north, above 2 km/h only               |
| Fix mode         | 1 no fix, 2 2D, 3 3D                                     |
| Fix              | text: `no fix`, `2D`, `3D`, `3D DGPS`, `3D RTK fixed`... |
| Horizontal error | metres, as estimated by gpsd                             |
| Satellites used  | count                                                    |
| Satellites seen  | count                                                    |

A value gpsd does not give stays unknown (never 0). Without a fix, only the fix
mode and the fix text are published, never a position.

## Before you start

- gpsd must listen on the network: start it with `-G` (on Debian, set
  `GPSD_OPTIONS="-G"` in `/etc/default/gpsd`, and for a socket-activated gpsd
  `ListenStream=0.0.0.0:2947` in `gpsd.socket`). Check with
  `gpspipe -w <address>` from another machine.
- TCP port 2947 (or yours) must be reachable from Gladys. gpsd has no
  password: keep it on your local network, never open it to the internet.

## Configuration

- **gpsd address**: name or IP address of the gpsd machine, `:port` if not
  2947 (IPv6 in brackets: `[fd00::12]:2947`).
- **Receiver** (optional): only if gpsd reads several receivers, the path of
  the one to follow as gpsd names it (`/dev/ttyACM0`). Empty: the first one that
  reports. The status lists the others.
- **Publication**: gpsd reports about once a second; the integration keeps the
  newest report and publishes at most every 10 s, 30 s, 1 min (default), 5 min
  or 15 min, only the values that changed (an unchanged value is sent again
  once an hour). The first report is published at once, unless a publication
  left less than one interval ago.
- **Position precision**: about 1 m (5 decimals), 10 m (4, default), 100 m (3)
  or 1 km (2). The altitude follows (0.1 m, 1 m, 10 m, 100 m).

## Privacy

A position is personal data. It is rounded before it reaches Gladys, never
written in the logs, the status nor the answer of the test button. Latitude,
longitude and the fix text keep no history by default; you may turn history
on for each feature in Gladys.

## Status and test button

The Configuration screen shows the state of the connection: connected with a
2D / 3D fix, no fix yet, no active receiver, a configured receiver that sends
nothing, no report for a minute, or the reason of a failure (refused, unknown
name, unreachable, not gpsd, another protocol version, gpsd stopped answering).
A lost connection is tried again after 5 s, then 10, 20... up to 5 minutes. The
**Test the connection** button tells the same state with the satellites and the
pace; it never opens a new connection.

## How it works

The integration reads the gpsd banner (`VERSION`, protocol 3), asks
`?WATCH={"enable":true,"json":true};` (JSON reports only, never NMEA), and reads
the `TPV` (position, speed, fix), `SKY` (satellites) and `DEVICE(S)` (receivers)
objects. A connection silent for a minute is asked `?VERSION;`; no answer within
10 s and it is closed and tried again. Lines are bounded (16 KiB) and so is the
flow (256 KiB/s).

## Identity of the device

The device id is a digest of the gpsd address (`host:port`): another address
makes another device; a receiver moved to another USB port stays the same
device.

Unofficial integration, not affiliated with the GPSD project.
