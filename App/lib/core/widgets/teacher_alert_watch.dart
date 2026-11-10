import 'teacher_alert_card.dart' show alertTime;
import 'backend_panels.dart' show backendRefresh;

import 'dart:async';

import 'package:flutter/material.dart';

import '../backend.dart';

/// Foreground only, one center stream on the Teacher shell. Persisted reads are
/// authoritative. No RSSI inference, background service or delivery claims.
class TeacherAlertWatch extends StatefulWidget {
  final Widget child;
  final VoidCallback onOpen;
  const TeacherAlertWatch({
    super.key,
    required this.child,
    required this.onOpen,
  });
  @override
  State<TeacherAlertWatch> createState() => _TeacherAlertWatchState();
}

class _TeacherAlertWatchState extends State<TeacherAlertWatch>
    with WidgetsBindingObserver {
  Timer? _poll, _retry;
  StreamSubscription<Map<String, dynamic>>? _stream;
  final _seen = <String>{};
  bool _foreground = true,
      _busy = false,
      _queued = false,
      _primed = false,
      _outage = false;
  int _generation = 0;
  final _clock = Stopwatch()..start();
  ScaffoldMessengerState? _messenger;
  int? _frameUs;
  bool get _active =>
      mounted &&
      _foreground &&
      BackendSession.instance.signedIn &&
      BackendSession.instance.teacher;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    BackendSession.instance.addListener(_sessionChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _connect();
      _read();
    });
    _poll = Timer.periodic(const Duration(seconds: 3), (_) => _read());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _messenger = ScaffoldMessenger.maybeOf(context);
  }

  void _sessionChanged() {
    if (!BackendSession.instance.signedIn) {
      _stop();
      _seen.clear();
      _primed = false;
      _messenger?.clearSnackBars();
    }
  }

  void _stop() {
    _generation++;
    _stream?.cancel();
    _stream = null;
    _retry?.cancel();
    _retry = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _stop();
    if (_active) {
      _connect();
      _read();
    }
  }

  void _connect() {
    if (!_active ||
        _stream != null ||
        !BackendSession.instance.api.enableStreams) {
      return;
    }
    final generation = _generation;
    void retry() {
      if (generation != _generation || !_active) return;
      _stream = null;
      _retry?.cancel();
      _retry = Timer(const Duration(seconds: 5), _connect);
    }

    _stream = BackendSession.instance.api.teacherUpdates().listen(
      (event) {
        if (generation == _generation && _active && event['topics'] is List) {
          final topics = event['topics'] as List;
          if (topics.contains('attendance') || topics.contains('pickups')) {
            // Routine RFID attendance has no new danger Alert. Refresh the
            // authoritative roster/counts directly from this scoped invalidation.
            backendRefresh.value++;
          }
          if (!topics.contains('alerts')) return;
          _frameUs = _clock.elapsedMicroseconds;
          if (const bool.fromEnvironment('CHILDGUARD_LATENCY_DEBUG')) {
            debugPrint(
              'LATENCY phase=teacher_frame notificationId=${event['id']} at_us=$_frameUs',
            );
          }
          _read();
        }
      },
      onError: (_) => retry(),
      onDone: retry,
      cancelOnError: true,
    );
  }

  Future<void> _read() async {
    if (!_active) return;
    if (_busy) {
      _queued = true;
      return;
    }
    _busy = true;
    final frameUs = _frameUs;
    _frameUs = null;
    final generation = _generation;
    try {
      final data = await BackendSession.instance.api.request(
        '/api/v1/mobile/alerts?review=false&limit=25&offset=0',
      );
      if (!mounted || !_active || generation != _generation) return;
      if (data is! List) {
        throw const ApiFailure('Unexpected safety alert response.');
      }
      final fresh = <Map<String, dynamic>>[];
      for (final value in data) {
        final row = Map<String, dynamic>.from(value as Map),
            id = value['id'] as String;
        if (_seen.add(id) &&
            [
              'DANGER_ZONE_NEAR',
              'TAMPER_LOOP_OPEN',
              'WEARABLE_CONNECTION_LOST',
              'LOW_ACTIVITY_ADVISORY',
            ].contains(row['kind']) &&
            row['checkedByMe'] != true) {
          fresh.add(row);
        }
      }
      while (_seen.length > 512) {
        _seen.remove(_seen.first);
      }
      _outage = false;
      if (_primed && fresh.isNotEmpty) {
        // Reuse the existing refresh signal; no second stream or notification service.
        backendRefresh.value++;
        final row = fresh.first, beacon = row['event']?['beacon'];
        final messenger = ScaffoldMessenger.of(context);
        messenger.clearSnackBars();
        messenger.showSnackBar(
          SnackBar(
            duration: const Duration(seconds: 10),
            backgroundColor:
                [
                  'WEARABLE_CONNECTION_LOST',
                  'LOW_ACTIVITY_ADVISORY',
                ].contains(row['kind'])
                ? const Color(0xFF805500)
                : row['kind'] == 'TAMPER_LOOP_OPEN'
                ? const Color(0xFFB42323)
                : null,
            content: Text(
              '${row['kind'] == 'WEARABLE_CONNECTION_LOST'
                  ? 'Wearable Connection Lost'
                  : row['kind'] == 'LOW_ACTIVITY_ADVISORY'
                  ? 'Low movement detected'
                  : row['kind'] == 'TAMPER_LOOP_OPEN'
                  ? 'Wearable tamper detected'
                  : 'Recorded danger-zone alert'}\n${row['child']?['name'] ?? 'Authorized child'} · ${row['event']?['device']?['hardwareId'] ?? 'Wearable'}\n${row['kind'] == 'WEARABLE_CONNECTION_LOST'
                  ? 'Wearable has stopped communicating with ChildGuard.'
                  : row['kind'] == 'LOW_ACTIVITY_ADVISORY'
                  ? 'Measured movement is lower than usual. Please check on the child.'
                  : row['kind'] == 'TAMPER_LOOP_OPEN'
                  ? 'Tamper loop disconnected. Please check the child and wearable.'
                  : '${beacon?['name'] ?? beacon?['hardwareId'] ?? 'Beacon'} ${beacon?['location'] ?? ''}'}\n${alertTime(row['createdAt'])}',
            ),
            action: SnackBarAction(
              label: 'View alerts',
              onPressed: widget.onOpen,
            ),
          ),
        );
        if (const bool.fromEnvironment('CHILDGUARD_LATENCY_DEBUG')) {
          debugPrint(
            'LATENCY phase=teacher_notice_requested alertId=${row['id']} eventId=${row['event']?['eventId']} at_us=${_clock.elapsedMicroseconds} frame_to_request_us=${frameUs == null ? 'poll' : _clock.elapsedMicroseconds - frameUs}',
          );
        }
      }
      _primed = true;
    } catch (_) {
      if (mounted && _active && generation == _generation && !_outage) {
        _outage = true;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Safety updates unavailable. Retrying while the app is open.',
            ),
          ),
        );
      }
    } finally {
      _busy = false;
      if (_queued && _active) {
        _queued = false;
        unawaited(_read());
      }
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _stop();
    BackendSession.instance.removeListener(_sessionChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
