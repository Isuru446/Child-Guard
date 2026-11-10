import '../../core/widgets/teacher_alert_card.dart';

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart'
    show backendRefresh, backendTab, BackendTabScope;
import '../../core/app_colors.dart';

/// Only saved, policy-qualified danger records. Raw proximity never creates a notice.
List<Map<String, dynamic>> teacherHomeDangerAlerts(dynamic data) {
  if (data is! List) {
    throw const ApiFailure('Unexpected danger alert response.');
  }
  final unique = <String, Map<String, dynamic>>{};
  for (final value in data) {
    if (value is! Map) {
      throw const ApiFailure('Unexpected danger alert response.');
    }
    if (!['DANGER_ZONE_NEAR', 'TAMPER_LOOP_OPEN'].contains(value['kind'])) {
      continue;
    }
    if (value['state'] != 'RECORDED' ||
        value['id'] is! String ||
        value['id'].isEmpty) {
      throw const ApiFailure('Unexpected danger alert response.');
    }
    if (value['checkedByMe'] == true) continue;
    final childId = value['child']?['id'];
    if (childId is! String || childId.isEmpty) {
      throw const ApiFailure('Unexpected recorded child identity.');
    }
    final previous = unique[childId];
    if (previous == null ||
        (DateTime.tryParse('${value['createdAt']}')?.millisecondsSinceEpoch ??
                0) >
            (DateTime.tryParse('${previous['createdAt']}')
                    ?.millisecondsSinceEpoch ??
                0)) {
      unique[childId] = Map<String, dynamic>.from(value);
    }
  }
  final rows = unique.values.toList();
  rows.sort((a, b) {
    final x = DateTime.tryParse('${a['createdAt']}'),
        y = DateTime.tryParse('${b['createdAt']}');
    return (y?.millisecondsSinceEpoch ?? 0).compareTo(
      x?.millisecondsSinceEpoch ?? 0,
    );
  });
  return rows.take(5).toList();
}

/// The current-day roster is scoped and dated by the server, not the phone clock.
Map<String, int> teacherHomeAttendanceCounts(List<Map<String, dynamic>> rows) {
  final counts = {
    'PRESENT': 0,
    'CHECKIN_PENDING': 0,
    'ABSENT': 0,
    'CHECKED_OUT': 0,
  };
  final children = <String, String>{};
  String? day;
  for (final row in rows) {
    final id = row['child']?['id'] ?? row['childId'],
        date = row['day'],
        status = row['status'];
    if (id is! String ||
        date is! String ||
        !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date) ||
        status is! String) {
      throw const ApiFailure('Unexpected attendance response.');
    }
    day ??= date;
    if (day != date) {
      throw const ApiFailure('Attendance day changed. Refresh and try again.');
    }
    if (children.containsKey(id) && children[id] != status) {
      throw const ApiFailure('Attendance changed. Refresh and try again.');
    }
    if (children.containsKey(id)) continue;
    children[id] = status;
    if (counts.containsKey(status)) counts[status] = counts[status]! + 1;
  }
  return counts;
}

class TeacherHomeDashboard extends StatefulWidget {
  final VoidCallback onOpenAlerts, onOpenAttendance;
  const TeacherHomeDashboard({
    super.key,
    required this.onOpenAlerts,
    required this.onOpenAttendance,
  });
  @override
  State<TeacherHomeDashboard> createState() => _TeacherHomeDashboardState();
}

class _TeacherHomeDashboardState extends State<TeacherHomeDashboard>
    with WidgetsBindingObserver {
  late final BackendSession _session;
  Timer? _timer;
  List<Map<String, dynamic>>? _alerts;
  Map<String, int>? _counts;
  bool _dangerError = false,
      _attendanceError = false,
      _busy = false,
      _queued = false,
      _foreground = true;
  int _generation = 0;
  String? _scope, _attendanceDay;
  bool? _wasVisible;
  String? get _identity {
    final id = _session.user?['id'], center = _session.user?['centerId'];
    return _session.signedIn &&
            _session.teacher &&
            id is String &&
            id.isNotEmpty &&
            center is String &&
            center.isNotEmpty
        ? '$id:$center'
        : null;
  }

  bool get _visible =>
      mounted &&
      _identity != null &&
      _foreground &&
      (context.getInheritedWidgetOfExactType<BackendTabScope>() == null ||
          backendTab.value == 0) &&
      (ModalRoute.of(context)?.isCurrent ?? true);
  @override
  void initState() {
    super.initState();
    _session = BackendSession.instance;
    _scope = _identity;
    WidgetsBinding.instance.addObserver(this);
    _session.addListener(_sessionChanged);
    backendRefresh.addListener(_refresh);
    backendTab.addListener(_refresh);
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
    // Existing Teacher watcher supplies prompt alert refreshes; this bounded fallback
    // also catches attendance changes made elsewhere without another event stream.
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _refresh());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final visible = _visible;
    if (_wasVisible == false && visible) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
    }
    _wasVisible = visible;
  }

  void _sessionChanged() {
    if (_scope != _identity) {
      _generation++;
      _scope = _identity;
      _alerts = null;
      _counts = null;
      _attendanceDay = null;
      _dangerError = false;
      _attendanceError = false;
      if (mounted) setState(() {});
    }
    _refresh();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (!_foreground) _generation++;
    if (_foreground) _refresh();
  }

  Future<void> _refresh() async {
    if (!_visible) return;
    if (_busy) {
      _queued = true;
      return;
    }
    _busy = true;
    setState(() {});
    final generation = _generation, scope = _identity;
    bool valid() => mounted && generation == _generation && scope == _identity;
    Future<void> danger() async {
      try {
        final rows = teacherHomeDangerAlerts(
          await _session.api.request(
            '/api/v1/mobile/alerts/danger-groups?limit=5&offset=0',
          ),
        );
        if (valid()) {
          setState(() {
            _alerts = rows;
            _dangerError = false;
          });
        }
      } catch (_) {
        if (valid()) setState(() => _dangerError = true);
      }
    }

    Future<void> attendance() async {
      try {
        final rows = await _session.api.all('/api/v1/attendance/roster');
        final counts = teacherHomeAttendanceCounts(rows);
        if (valid()) {
          setState(() {
            _counts = counts;
            _attendanceDay = rows.isEmpty ? null : rows.first['day'] as String;
            _attendanceError = false;
          });
        }
      } catch (_) {
        if (valid()) setState(() => _attendanceError = true);
      }
    }

    await Future.wait([danger(), attendance()]);
    _busy = false;
    if (mounted) setState(() {});
    if (_queued) {
      _queued = false;
      unawaited(_refresh());
    }
  }

  @override
  void dispose() {
    _generation++;
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _session.removeListener(_sessionChanged);
    backendRefresh.removeListener(_refresh);
    backendTab.removeListener(_refresh);
    super.dispose();
  }

  Widget _heading(String title, IconData icon, {Widget? action}) => Row(
    children: [
      Icon(icon, color: AppColors.primaryBlue),
      const SizedBox(width: 8),
      Expanded(
        child: Text(
          title,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
        ),
      ),
      ?action,
    ],
  );
  Widget _shell(Widget child) => Material(
    color: Theme.of(context).colorScheme.surface,
    elevation: 2,
    borderRadius: BorderRadius.circular(18),
    clipBehavior: Clip.antiAlias,
    child: child,
  );
  Widget _error(String message) => Row(
    children: [
      Expanded(
        child: Text(message, style: const TextStyle(color: Color(0xFF9B2424))),
      ),
      TextButton(
        onPressed: _busy ? null : _refresh,
        child: const Text('Retry'),
      ),
    ],
  );
  @override
  Widget build(BuildContext context) {
    if (_identity == null) {
      return const Text('Sign in as a Teacher to view this dashboard.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _shell(
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _heading(
                  'Danger Notifications',
                  Icons.shield_outlined,
                  action: IconButton(
                    tooltip: 'Refresh dashboard',
                    onPressed: _refresh,
                    icon: const Icon(Icons.refresh),
                  ),
                ),
                if (_busy && _alerts == null && _counts == null)
                  const LinearProgressIndicator(),
                if (_dangerError)
                  _error('Unable to load danger notifications.'),
                if (_alerts == null && !_dangerError)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('Loading danger notifications…'),
                  ),
                if (_alerts?.isEmpty == true && !_dangerError)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Row(
                      children: [
                        Icon(
                          Icons.verified_user_outlined,
                          color: AppColors.primaryBlue,
                        ),
                        SizedBox(width: 8),
                        Expanded(child: Text('No new danger notifications.')),
                      ],
                    ),
                  ),
                if (_alerts != null)
                  for (final alert in _alerts!)
                    Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: TeacherAlertCard(
                        key: ValueKey('$_identity:${alert['id']}'),
                        alert: alert,
                        group: true,
                        onOpen: widget.onOpenAlerts,
                        onChecked: () {
                          setState(
                            () => _alerts?.removeWhere(
                              (row) => row['id'] == alert['id'],
                            ),
                          );
                          backendRefresh.value++;
                        },
                      ),
                    ),
                if (_alerts?.isNotEmpty == true)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: widget.onOpenAlerts,
                      child: const Text('View all'),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        _shell(
          InkWell(
            key: const ValueKey('teacher-home-attendance'),
            onTap: widget.onOpenAttendance,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _heading(
                    'Children Attendance',
                    Icons.groups_outlined,
                    action: const Icon(Icons.chevron_right),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "${_attendanceDay == null ? 'Today\'s recorded attendance' : 'Recorded attendance: $_attendanceDay'}. Children not checked in are not counted as absent.",
                    style: const TextStyle(fontSize: 12),
                  ),
                  if (_attendanceError) _error('Unable to load attendance.'),
                  if (_counts == null && !_attendanceError)
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('Loading attendance…'),
                    ),
                  if (_counts != null) ...[
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _count(
                            'Present',
                            'PRESENT',
                            const Color(0xFF19733D),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _count(
                            'Pending',
                            'CHECKIN_PENDING',
                            const Color(0xFF8B6200),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: _count(
                            'Absent',
                            'ABSENT',
                            const Color(0xFFB42323),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _count(
                            'Checked Out',
                            'CHECKED_OUT',
                            AppColors.primaryBlue,
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 18),
      ],
    );
  }

  Widget _count(String label, String key, Color color) => Container(
    key: ValueKey('teacher-home-count-$key'),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.07),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(color: color, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        Text(
          '${_counts![key]}',
          style: TextStyle(
            color: color,
            fontSize: 24,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}
