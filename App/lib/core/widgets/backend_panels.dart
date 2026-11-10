import 'activity_baseline_card.dart';
import 'parent_child_profile_card.dart';
import 'parent_routine_notifications.dart';
import 'parent_danger_notifications.dart';
import 'teacher_alert_card.dart';
import 'tamper_status.dart';
import 'attendance_confirmation.dart';

import 'dart:async';

import 'package:flutter/material.dart';

import '../backend.dart';

final backendTab = ValueNotifier<int>(0);
final backendRefresh = ValueNotifier<int>(0);
typedef Json = Map<String, dynamic>;

/// Marks feeds inside the persistent tab stack. Pushed routes are independent
/// of the selected tab and must still load their data.
class BackendTabScope extends InheritedWidget {
  const BackendTabScope({super.key, required super.child});

  @override
  bool updateShouldNotify(BackendTabScope oldWidget) => false;
}

/// Freshness travels with a retained view, without destroying its state.
class BackendReadStatus extends InheritedWidget {
  final bool stale;
  final DateTime? updatedAt;
  const BackendReadStatus({
    super.key,
    required this.stale,
    required this.updatedAt,
    required super.child,
  });
  static BackendReadStatus? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<BackendReadStatus>();
  @override
  bool updateShouldNotify(BackendReadStatus oldWidget) =>
      stale != oldWidget.stale || updatedAt != oldWidget.updatedAt;
}

/// Shares refresh, lifecycle, loading, empty and error behavior across screens.
class BackendFeed extends StatefulWidget {
  final Future<dynamic> Function() load;
  final Widget Function(BuildContext, dynamic) builder;
  final int? tab;
  final String? Function(dynamic)? alertChild;
  final Widget? loading;
  final String? Function(dynamic)? refreshError;
  const BackendFeed({
    super.key,
    required this.load,
    required this.builder,
    this.tab,
    this.alertChild,
    this.loading,
    this.refreshError,
  });
  @override
  State<BackendFeed> createState() => _BackendFeedState();
}

class _BackendFeedState extends State<BackendFeed> with WidgetsBindingObserver {
  Timer? _timer;
  bool _busy = false;
  bool _foreground = true;
  bool _loaded = false;
  dynamic _value;
  String? _error;
  DateTime? _updatedAt;
  bool _manual = false;
  late final BackendSession _session;
  String? _scope, _token;
  String? get _identity => _session.signedIn
      ? '${_session.user?['id']}:${_session.user?['centerId']}:${_session.user?['role']}'
      : null;
  bool _queued = false;
  int _generation = 0;
  int _streamGeneration = 0;
  StreamSubscription<Map<String, dynamic>>? _updates;
  Timer? _reconnect;
  String? _streamChild;
  bool get _visible =>
      _foreground &&
      (context.getInheritedWidgetOfExactType<BackendTabScope>() == null ||
          widget.tab == null ||
          backendTab.value == widget.tab) &&
      (ModalRoute.of(context)?.isCurrent ?? true);
  @override
  void initState() {
    super.initState();
    _session = BackendSession.instance;
    _scope = _identity;
    _token = _session.api.token;
    _session.addListener(_sessionChanged);
    WidgetsBinding.instance.addObserver(this);
    backendTab.addListener(_refresh);
    backendRefresh.addListener(_refresh);
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
  }

  void _sessionChanged() {
    if (_scope != _identity || _token != _session.api.token) {
      _generation++;
      _scope = _identity;
      _token = _session.api.token;
      _stopStream();
      setState(() {
        _value = null;
        _loaded = false;
        _error = null;
        _updatedAt = null;
      });
    }
    if (_session.signedIn) _refresh();
  }

  Future<void> _manualRefresh() async {
    setState(() => _manual = true);
    await _refresh();
  }

  @override
  void didUpdateWidget(covariant BackendFeed oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.key != widget.key) _refresh();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (!_foreground) {
      _generation++;
      _stopStream();
    }
    if (_foreground) _refresh();
  }

  void _stopStream() {
    _streamGeneration++;
    _reconnect?.cancel();
    _reconnect = null;
    _updates?.cancel();
    _updates = null;
    _streamChild = null;
  }

  void _stream(String? childId) {
    if (!mounted) return;
    if (childId == null ||
        !BackendSession.instance.api.enableStreams ||
        !_visible) {
      _stopStream();
      return;
    }
    if (_streamChild == childId) return;
    _stopStream();
    _streamChild = childId;
    final own = _streamGeneration;
    void retry() {
      _updates = null;
      if (!mounted ||
          own != _streamGeneration ||
          !_visible ||
          !BackendSession.instance.signedIn) {
        return;
      }
      _reconnect?.cancel();
      _reconnect = Timer(const Duration(seconds: 5), () {
        _streamChild = null;
        _stream(childId);
      });
    }

    _updates = BackendSession.instance.api
        .childUpdates(childId)
        .listen(
          (event) {
            if (mounted &&
                own == _streamGeneration &&
                _visible &&
                event['topics'] is List &&
                (event['topics'] as List).contains('alerts')) {
              _refresh();
            }
          },
          onError: (_) => retry(),
          onDone: retry,
          cancelOnError: true,
        );
  }

  Future<void> _refresh() async {
    if (!mounted || !_visible || !BackendSession.instance.signedIn) {
      _stopStream();
      return;
    }
    if (_busy) {
      _queued = true;
      return;
    }
    final generation = _generation;
    setState(() => _busy = true);
    try {
      final value = await widget.load();
      if (mounted && _visible && generation == _generation) {
        setState(() {
          _value = value;
          _loaded = true;
          _error = widget.refreshError?.call(value);
          if (_error == null) _updatedAt = DateTime.now();
        });
        _stream(widget.alertChild?.call(value));
      }
    } catch (error) {
      if (mounted && _visible && generation == _generation) {
        setState(() {
          if (error is ApiFailure && [401, 403, 404].contains(error.status)) {
            _value = null;
            _loaded = false;
            _updatedAt = null;
            _stopStream();
          }
          _error = error is ApiFailure
              ? error.message
              : 'Could not load ChildGuard information.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _manual = false;
        });
      }
      if (_queued && mounted) {
        _queued = false;
        unawaited(_refresh());
      }
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _generation++;
    _stopStream();
    _session.removeListener(_sessionChanged);
    WidgetsBinding.instance.removeObserver(this);
    backendTab.removeListener(_refresh);
    backendRefresh.removeListener(_refresh);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final content = Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 48,
            child: Row(
              children: [
                Expanded(
                  child: _loaded && _error != null
                      ? Tooltip(
                          message:
                              '$_error${_updatedAt == null ? '' : '\nLast received: $_updatedAt'}',
                          child: const Text(
                            'Updates unavailable. Showing last received information.',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11,
                              color: Color(0xFF9A6400),
                            ),
                          ),
                        )
                      : const SizedBox.shrink(),
                ),
                IconButton(
                  tooltip: 'Refresh',
                  onPressed: _manual && _busy ? null : _manualRefresh,
                  icon: _manual && _busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh),
                ),
              ],
            ),
          ),
          if (_loaded)
            BackendReadStatus(
              key: const ValueKey('backend-loaded-content'),
              stale: _error != null,
              updatedAt: _updatedAt,
              child: Builder(
                builder: (context) => widget.builder(context, _value),
              ),
            )
          else if (_error != null)
            Padding(padding: const EdgeInsets.all(16), child: Text(_error!))
          else if (widget.loading != null && _visible)
            widget.loading!
          else if (_visible && _busy)
            const LinearProgressIndicator()
          else if (!_busy)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('No information loaded.'),
            ),
        ],
      );
      return constraints.hasBoundedHeight
          ? SingleChildScrollView(child: content)
          : content;
    },
  );
}

class ChildPanel extends StatefulWidget {
  final String section;
  final int? tab;
  final String? childId;
  final String? day;
  final ValueChanged<String>? onOpenAlerts;
  final ValueChanged<String>? onOpenUpdates, onChildSelected;
  final bool hideSelector;
  final String? alertCategory;
  const ChildPanel({
    super.key,
    this.section = 'overview',
    this.tab,
    this.childId,
    this.day,
    this.onOpenAlerts,
    this.onOpenUpdates,
    this.onChildSelected,
    this.hideSelector = false,
    this.alertCategory,
  });
  @override
  State<ChildPanel> createState() => _ChildPanelState();
}

class _ChildPanelState extends State<ChildPanel> {
  late final BackendSession _session;
  String? _selected;
  int _alertOffset = 0;
  String _activitySource = 'recorded';
  final Map<String, dynamic> _sections = {};
  String? _cacheScope, _cacheToken;
  bool get _homeDanger =>
      widget.section == 'overview' &&
      widget.onOpenAlerts != null &&
      BackendSession.instance.user?['role'] == 'PARENT';
  List<Json> _safeAlerts(dynamic value, String childId) {
    if (value is! List) throw const ApiFailure('Unable to load saved alerts.');
    final rows = <String, Json>{};
    for (final item in value) {
      final row = Map<String, dynamic>.from(item as Map);
      if (row['child']?['id'] != null && row['child']['id'] != childId) {
        throw const ApiFailure('Alert child does not match this selection.');
      }
      if (row['kind'] != 'BEACON_SIGNAL_LOST' && row['id'] is String) {
        rows[row['id'] as String] = row;
      }
    }
    return rows.values.toList();
  }

  @override
  void initState() {
    super.initState();
    _session = BackendSession.instance;
    _session.addListener(_invalidateSections);
    _selected = widget.childId;
  }

  void _invalidateSections() {
    _sections.clear();
    _cacheScope = null;
    _cacheToken = null;
  }

  @override
  void dispose() {
    _session.removeListener(_invalidateSections);
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant ChildPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.childId != widget.childId) {
      _selected = widget.childId;
      _activitySource = 'recorded';
    }
  }

  ApiClient get api => BackendSession.instance.api;
  Future<Json> _load() async {
    try {
      return await _readAuthorized();
    } on ApiFailure catch (error) {
      if ([401, 403, 404].contains(error.status)) _invalidateSections();
      rethrow;
    }
  }

  Future<Json> _readAuthorized() async {
    final children = await api.all('/api/v1/mobile/children');
    if (children.isEmpty) return {'children': children};
    final selected = _selected;
    final matches = children.where((c) => c['id'] == selected);
    if (selected != null && matches.isEmpty) {
      throw const ApiFailure(
        'This child is no longer available to this account.',
        404,
      );
    }
    final chosen = selected == null ? children.first : matches.first;
    final prefix = '/api/v1/mobile/children/${chosen['id']}';
    final cacheScope =
        '${BackendSession.instance.user?['id']}:${BackendSession.instance.user?['centerId']}:${BackendSession.instance.user?['role']}:${chosen['id']}:${widget.section}:${widget.day}:$_alertOffset:${widget.alertCategory}:$_activitySource';
    if (_cacheScope != cacheScope || _cacheToken != api.token) {
      _sections.clear();
      _cacheScope = cacheScope;
      _cacheToken = api.token;
    }

    final sections = widget.section == 'overview'
        ? _homeDanger
              ? ['device', 'updates', 'danger']
              : ['attendance', 'device', 'activity', 'alerts']
        : [widget.section];
    var alertsHaveMore = false;
    Future<dynamic> sectionRead(String section) async {
      if (_homeDanger && section == 'device') {
        try {
          return await api.request('$prefix/device');
        } catch (error) {
          if (error is ApiFailure && [401, 403, 404].contains(error.status)) {
            rethrow;
          }
          return {'unavailable': true};
        }
      }

      if (section == 'danger') {
        try {
          final value = await api.request(
            '$prefix/alerts?category=safety&limit=1&offset=0',
          );
          if (value is! List ||
              value.any(
                (row) =>
                    row is! Map ||
                    ![
                      'DANGER_ZONE_NEAR',
                      'GEOFENCE_OUTSIDE',
                      'TAMPER_LOOP_OPEN',
                    ].contains(row['kind']),
              )) {
            throw const ApiFailure('Unexpected danger notification response.');
          }
          return {'rows': _safeAlerts(value, chosen['id'] as String)};
        } catch (error) {
          if (error is ApiFailure && [401, 403, 404].contains(error.status)) {
            rethrow;
          }
          return {'error': true};
        }
      }
      if (section == 'updates') {
        try {
          final value = await api.request(
            '$prefix/updates?limit=${_homeDanger ? 1 : 25}&offset=${_homeDanger ? 0 : _alertOffset}',
          );
          alertsHaveMore = value is List && value.length == 25;
          return {'rows': _safeAlerts(value, chosen['id'] as String)};
        } catch (error) {
          if (error is ApiFailure && [401, 403, 404].contains(error.status)) {
            rethrow;
          }
          return {'error': true};
        }
      }
      if (section == 'alerts') {
        final value = await api.request(
          '$prefix/alerts?limit=25&offset=$_alertOffset${widget.alertCategory == 'safety' ? '&category=safety' : ''}',
        );
        alertsHaveMore = value is List && value.length == 25;
        return _safeAlerts(value, chosen['id'] as String);
      }
      if (section == 'activity' && _activitySource == 'sample') {
        try {
          return await api.request('$prefix/activity?source=sample');
        } on ApiFailure catch (error) {
          if (error.status != 404) rethrow;
          // Disabling the development flag must not strand the parent in an
          // unavailable sample view. The returned provenance remains recorded.
          final recorded = await api.request('$prefix/activity') as Json;
          return {...recorded, 'sampleUnavailable': true};
        }
      }
      return api.request(
        '$prefix/$section${section == 'attendance' && (widget.day != null || widget.section == 'overview') ? '?day=${widget.day ?? DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30)).toIso8601String().split('T').first}' : ''}',
      );
    }

    final values = await Future.wait(sections.map(sectionRead));
    final failedSections = <String>[];
    for (
      var i = 0;
      i < sections.length &&
          _cacheScope == cacheScope &&
          _cacheToken == api.token;
      i++
    ) {
      final value = values[i], section = sections[i];
      if (value is Map &&
          (value['error'] == true || value['unavailable'] == true)) {
        failedSections.add(section);
        if (_sections.containsKey(section)) values[i] = _sections[section];
      } else {
        _sections[section] = value;
      }
    }

    if (widget.onChildSelected != null && mounted && selected == _selected) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && selected == _selected) {
          widget.onChildSelected!(chosen['id'] as String);
        }
      });
    }
    return {
      'children': children,
      'child': chosen,
      'alertsHaveMore': alertsHaveMore,
      'refreshError': failedSections.isEmpty
          ? null
          : 'Unable to refresh ${failedSections.join(', ')}.',
      for (var i = 0; i < sections.length; i++) sections[i]: values[i],
    };
  }

  @override
  Widget build(BuildContext context) => BackendFeed(
    key: ValueKey(
      '${widget.section}:$_selected:$_activitySource:${widget.day}:$_alertOffset:${widget.alertCategory}:${BackendSession.instance.user?['id']}',
    ),
    tab: widget.tab,
    loading: _homeDanger
        ? Column(
            children: [
              ParentDangerNotifications(
                loading: true,
                onRetry: () => backendRefresh.value++,
              ),
              ParentRoutineNotifications(
                loading: true,
                onRetry: () => backendRefresh.value++,
              ),
            ],
          )
        : null,
    load: _load,
    refreshError: (value) => (value as Json)['refreshError'] as String?,
    alertChild:
        widget.section == 'overview' ||
            widget.section == 'alerts' ||
            widget.section == 'updates' ||
            widget.section == 'activity'
        ? (value) {
            return (value as Json)['child']?['id'] as String?;
          }
        : null,
    builder: (context, value) {
      final data = value as Json;
      final children = (data['children'] as List).cast<Json>();
      if (children.isEmpty) {
        return const ListTile(
          title: Text('No children are linked to your account yet.'),
        );
      }
      final child = data['child'] as Json;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_homeDanger)
            ParentChildProfileCard(
              child: child,
              children: children,
              device: data['device']?['unavailable'] == true
                  ? null
                  : data['device'] as Json?,
              deviceUnavailable: data['device']?['unavailable'] == true,
              onSelected: (id) => setState(() {
                _selected = id;
                _activitySource = 'recorded';
                _alertOffset = 0;
                widget.onChildSelected?.call(id);
              }),
            )
          else if (!widget.hideSelector && children.length == 1)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.child_care),
              title: Text(child['name'] as String),
            )
          else if (!widget.hideSelector)
            DropdownButtonFormField<String>(
              initialValue: child['id'] as String,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Child'),
              items: children
                  .map(
                    (c) => DropdownMenuItem(
                      value: c['id'] as String,
                      child: Text(c['name'] as String),
                    ),
                  )
                  .toList(),
              onChanged: (id) => setState(() {
                _selected = id;
                _activitySource = 'recorded';
                _alertOffset = 0;
                if (id != null) widget.onChildSelected?.call(id);
              }),
            ),
          if (_homeDanger)
            ParentDangerNotifications(
              alerts: (data['danger']?['rows'] as List? ?? []).cast<Json>(),
              failed: data['danger']?['error'] == true,
              onRetry: () => backendRefresh.value++,
              onOpenAlerts: () => widget.onOpenAlerts!(child['id'] as String),
            ),
          if (_homeDanger)
            ParentRoutineNotifications(
              updates: (data['updates']?['rows'] as List? ?? []).cast<Json>(),
              failed: data['updates']?['error'] == true,
              onRetry: () => backendRefresh.value++,
              onOpen: () => widget.onOpenUpdates?.call(child['id'] as String),
            ),
          if (widget.section == 'updates') ...[
            if (data['updates']?['error'] == true)
              TextButton(
                onPressed: () => backendRefresh.value++,
                child: const Text('Unable to load recent updates. Retry'),
              )
            else if ((data['updates']?['rows'] as List? ?? []).isEmpty)
              const ListTile(title: Text('No recent updates.'))
            else
              for (final row in data['updates']['rows'])
                ParentRoutineCard(update: row as Json),
          ],
          if (!_homeDanger &&
              widget.section == 'overview' &&
              (child['dateOfBirth'] != null || child['groupName'] != null))
            ListTile(
              title: const Text('Child details'),
              subtitle: Text(
                'Birth date: ${child['dateOfBirth']?.toString().split('T').first ?? 'Not supplied'} / Group: ${child['groupName'] ?? 'Not supplied'}',
              ),
            ),
          if (data.containsKey('attendance'))
            ..._attendance(data['attendance'] as List),
          if (!_homeDanger && data.containsKey('device'))
            _device(data['device']),
          if (widget.section == 'activity' &&
              data['activity']?['historyPreviewAvailable'] == true)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Wrap(
                spacing: 8,
                children: [
                  for (final source in ['recorded', 'sample'])
                    ChoiceChip(
                      label: Text(
                        source == 'sample'
                            ? 'Sample history'
                            : 'Recorded history',
                      ),
                      selected: _activitySource == source,
                      onSelected: (_) =>
                          setState(() => _activitySource = source),
                    ),
                ],
              ),
            ),
          if (data['activity']?['sampleUnavailable'] == true)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Sample history is unavailable. Showing recorded history.',
              ),
            ),
          if (data.containsKey('activity')) _activity(data['activity'] as Json),
          if (data.containsKey('alerts'))
            ..._alerts((data['alerts'] as List).cast<Json>()),
          if (widget.section == 'alerts' || widget.section == 'updates')
            Row(
              children: [
                TextButton(
                  onPressed: _alertOffset == 0
                      ? null
                      : () => setState(() => _alertOffset -= 25),
                  child: const Text('Previous'),
                ),
                Expanded(
                  child: Center(child: Text('Page ${_alertOffset ~/ 25 + 1}')),
                ),
                TextButton(
                  onPressed: data['alertsHaveMore'] != true
                      ? null
                      : () => setState(() => _alertOffset += 25),
                  child: const Text('Next'),
                ),
              ],
            ),
        ],
      );
    },
  );
  List<Widget> _attendance(List rows) => [
    ListTile(
      title: Text(
        widget.day == null
            ? widget.section == 'overview'
                  ? "Today's attendance"
                  : 'Attendance history (latest 25 records)'
            : 'Attendance · ${widget.day}',
      ),
    ),
    if (rows.isEmpty)
      const ListTile(title: Text('No attendance records for this selection.')),
    for (final row in rows)
      Card(
        child: ListTile(
          leading: const Icon(Icons.calendar_month),
          title: Text('${row['day']} · ${attendanceLabel(row['status'])}'),
          subtitle: Text(
            row['status'] == 'ABSENT'
                ? 'A Teacher recorded this absence.'
                : (row['confirmations'] as List).isEmpty
                ? 'No recorded confirmation'
                : attendanceConfirmationText(row['confirmations'][0]),
          ),
        ),
      ),
  ];
  Widget _device(dynamic device) => Card(
    child: ListTile(
      leading: const Icon(Icons.watch_outlined),
      title: Text(
        device == null
            ? 'No registered wearable'
            : '${device['hardwareId']} · ${device['connectionState']}',
      ),
      subtitle: Text(
        device == null
            ? 'Device information unavailable.'
            : '${tamperStatusText(device)}\nLast communication: ${device['lastSeen'] ?? 'Unavailable'}\nBattery measurement unavailable. Connection is separate from BLE proximity.\nGPS: ${device['gpsMonitoring']?['latestStatus'] ?? 'Not reported'}',
      ),
    ),
  );
  Widget _activity(Json activity) => ActivityBaselineCard(activity: activity);

  List<Widget> _alerts(List rows) => [
    if (rows.isEmpty) const ListTile(title: Text('No recorded alerts.')),
    for (final row in rows)
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TeacherAlertCard(
          key: ValueKey(row['id']),
          alert: Map<String, dynamic>.from(row),
          readOnly: true,
          onOpen: () => showDialog<void>(
            context: context,
            builder: (context) => AlertDialog(
              title: Text(teacherAlertStyle(row['kind']).title),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Recorded: ${alertTime(row['createdAt'])}'),
                    Text(
                      'Child: ${alertValue(row['child']?['name'], 'Not available')}',
                    ),
                    Text(
                      'Wearable: ${alertValue(row['event']?['device']?['hardwareId'], 'Not available')}',
                    ),
                    Text('Observed: ${alertTime(row['event']?['observedAt'])}'),
                    Text(
                      row['location'] == null
                          ? 'No valid fix attached'
                          : 'Recorded location: ${row['location']['latitude']}, ${row['location']['longitude']}',
                    ),
                    const Text(
                      'Recorded evidence is not independent confirmation of an emergency.',
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Close'),
                ),
              ],
            ),
          ),
        ),
      ),
    const ListTile(
      subtitle: Text(
        'Saved alerts, 25 per page. Background push is unavailable.',
      ),
    ),
  ];
}

/// Teacher history covers all authorized center children, not only a selector.
class TeacherAlertsPanel extends StatefulWidget {
  const TeacherAlertsPanel({super.key});
  @override
  State<TeacherAlertsPanel> createState() => _TeacherAlertsPanelState();
}

class _TeacherAlertsPanelState extends State<TeacherAlertsPanel> {
  int _offset = 0;
  @override
  Widget build(BuildContext context) => BackendFeed(
    key: ValueKey('teacher-alert-page-$_offset'),
    tab: 2,
    load: () => BackendSession.instance.api.request(
      '/api/v1/mobile/alerts?limit=25&offset=$_offset',
    ),
    builder: (context, data) {
      final rows = (data as List).cast<Map<String, dynamic>>();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text('Checked means reviewed, not resolved.'),
          ),
          const Text(
            'Checking a danger alert also covers earlier danger alerts for the same child. Connection warnings are checked individually.',
            style: TextStyle(fontSize: 12),
          ),
          if (rows.isEmpty) const ListTile(title: Text('No recorded alerts.')),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: TeacherAlertCard(
                key: ValueKey(
                  '${BackendSession.instance.user?['id']}:${row['id']}',
                ),
                alert: row,
                onChecked: () {
                  backendRefresh.value++;
                },
              ),
            ),
          Row(
            children: [
              TextButton(
                onPressed: _offset == 0
                    ? null
                    : () => setState(() => _offset -= 25),
                child: const Text('Previous'),
              ),
              Expanded(child: Center(child: Text('Page ${_offset ~/ 25 + 1}'))),
              TextButton(
                onPressed: rows.length < 25
                    ? null
                    : () => setState(() => _offset += 25),
                child: const Text('Next'),
              ),
            ],
          ),
        ],
      );
    },
  );
}

String attendanceLabel(Object? status) =>
    const {
      'PRESENT': 'Present',
      'CHECKIN_PENDING': 'Waiting for Confirmation',
      'NOT_CHECKED_IN': 'Not Checked In Yet',
      'NO_RECORD': 'No Attendance Recorded',
      'ABSENT': 'Absent',
      'CHECKED_OUT': 'Checked Out',
    }[status] ??
    '$status';

class PendingAttendancePanel extends StatefulWidget {
  final String title;
  const PendingAttendancePanel({super.key, this.title = "Today's attendance"});
  @override
  State<PendingAttendancePanel> createState() => _PendingAttendancePanelState();
}

class _PendingAttendancePanelState extends State<PendingAttendancePanel> {
  final Set<String> _submitting = {};
  Future<void> _confirm(Json row) async {
    final id = row['id'] as String;
    if (!_submitting.add(id)) return;
    setState(() {});
    try {
      final result = await BackendSession.instance.api.request(
        '/api/v1/attendance/$id/confirm',
        method: 'POST',
        body: {
          if (row['attendanceEpoch'] != null)
            'attendanceEpoch': row['attendanceEpoch'],
        },
      );
      if (result['status'] != 'PRESENT') {
        throw const ApiFailure('Approval was not confirmed.');
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Attendance confirmed by the backend.')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error is ApiFailure
                  ? error.message
                  : 'Confirmation failed. Refresh and try again.',
            ),
          ),
        );
      }
    } finally {
      _submitting.remove(id);
      if (mounted) setState(() {});
      backendRefresh.value++;
    }
  }

  Future<void> _checkout(Json row) async {
    final id = row['id'] as String;
    if (!_submitting.add(id)) return;
    setState(() {});
    try {
      final confirmedAt = (row['confirmations'] as List).first['confirmedAt'];
      final result = await BackendSession.instance.api.request(
        '/api/v1/attendance/$id/checkout',
        method: 'POST',
        body: {
          'confirmedAt': confirmedAt,
          'departureConfirmed': true,
          if (row['attendanceEpoch'] != null)
            'attendanceEpoch': row['attendanceEpoch'],
        },
      );
      if (result['status'] != 'CHECKED_OUT') {
        throw const ApiFailure('Check-out was not confirmed.');
      }
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Child checked out.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error is ApiFailure
                  ? error.message
                  : 'Check-out failed. Refresh and try again.',
            ),
          ),
        );
      }
    } finally {
      _submitting.remove(id);
      if (mounted) setState(() {});
      backendRefresh.value++;
    }
  }

  Future<void> _absence(Json row) async {
    final id = row['id'] as String;
    final correct = row['canCorrectAbsence'] == true;
    final approved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(correct ? 'Correct Absence?' : 'Mark Child as Absent?'),
        content: Text(
          correct
              ? "Return ${row['child']['name']} to Not Checked In Yet? Use normal Gate check-in and Teacher confirmation, or the registered RFID card."
              : "Are you sure you want to mark ${row['child']['name']} as absent for today?",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(correct ? 'Correct Absence' : 'Mark Absent'),
          ),
        ],
      ),
    );
    if (approved != true || !mounted || !_submitting.add(id)) return;
    setState(() {});
    try {
      final result = await BackendSession.instance.api.request(
        correct
            ? '/api/v1/attendance/$id/absence/correct'
            : '/api/v1/attendance/absence',
        method: 'POST',
        body: {
          'day': row['day'],
          'confirmed': true,
          if (correct) 'absenceId': row['absenceId'],
          if (!correct) ...{
            'childId': row['child']['id'],
            'attendanceId': row['attendanceId'],
            'expectedStatus': row['status'],
            if (row['attendanceEpoch'] != null)
              'attendanceEpoch': row['attendanceEpoch'],
          },
        },
      );
      if (result['status'] != (correct ? 'NOT_CHECKED_IN' : 'ABSENT')) {
        throw const ApiFailure(
          'Attendance was not saved. Refresh and try again.',
        );
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              correct
                  ? 'Absence corrected. Use Gate check-in and Teacher confirmation, or the registered RFID card.'
                  : "${row['child']['name']} has been marked absent.",
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error is ApiFailure
                  ? error.message
                  : 'Attendance could not be saved. Refresh and try again.',
            ),
          ),
        );
      }
    } finally {
      _submitting.remove(id);
      if (mounted) setState(() {});
      backendRefresh.value++;
    }
  }

  @override
  Widget build(BuildContext context) => BackendFeed(
    load: () => BackendSession.instance.api.all('/api/v1/attendance/roster'),
    builder: (context, value) {
      final rows = (value as List).cast<Json>();
      return Column(
        children: [
          ListTile(title: Text(widget.title)),
          if (rows.isEmpty)
            const ListTile(title: Text('No attendance records today.')),
          for (final row in rows)
            Card(
              child: ListTile(
                title: Text('${row['child']['name']}'),
                subtitle: Text(
                  '${row['day']} - ${attendanceLabel(row['status'])}${(row['confirmations'] as List? ?? []).isNotEmpty && row['confirmations'][0]['method'] == 'RFID_CARD' ? "\n${attendanceConfirmationText(row['confirmations'][0])}" : ""}${row['checkout'] != null
                      ? "\nChecked out: ${row['checkout']['at']}"
                      : row['checkoutBlockedByPickup'] == true
                      ? "\nFinish the pending Pickup request before check-out."
                      : ""}',
                ),
                trailing: row['canConfirm'] == true
                    ? FilledButton(
                        onPressed: _submitting.contains(row['id'])
                            ? null
                            : () async {
                                final approved = await showDialog<bool>(
                                  context: context,
                                  builder: (context) => AlertDialog(
                                    title: const Text('Confirm arrival?'),
                                    content: Text(
                                      'Confirm you have physically seen ${row['child']['name']} arrive?',
                                    ),
                                    actions: [
                                      TextButton(
                                        onPressed: () =>
                                            Navigator.pop(context, false),
                                        child: const Text('Cancel'),
                                      ),
                                      FilledButton(
                                        onPressed: () =>
                                            Navigator.pop(context, true),
                                        child: const Text('Confirm'),
                                      ),
                                    ],
                                  ),
                                );
                                if (approved == true && mounted) {
                                  await _confirm(row);
                                }
                              },
                        child: Text(
                          _submitting.contains(row['id'])
                              ? 'Confirming…'
                              : 'Confirm',
                        ),
                      )
                    : row['canCheckout'] == true
                    ? FilledButton(
                        onPressed: _submitting.contains(row['id'])
                            ? null
                            : () async {
                                final approved = await showDialog<bool>(
                                  context: context,
                                  builder: (context) => AlertDialog(
                                    title: const Text('Check out child?'),
                                    content: Text(
                                      "Confirm that ${row['child']['name']} has physically left. This records attendance only; it does not verify a pickup person or complete a pickup request.",
                                    ),
                                    actions: [
                                      TextButton(
                                        onPressed: () =>
                                            Navigator.pop(context, false),
                                        child: const Text('Cancel'),
                                      ),
                                      FilledButton(
                                        onPressed: () =>
                                            Navigator.pop(context, true),
                                        child: const Text('Check Out'),
                                      ),
                                    ],
                                  ),
                                );
                                if (approved == true && mounted) {
                                  await _checkout(row);
                                }
                              },
                        child: Text(
                          _submitting.contains(row['id'])
                              ? 'Checking out...'
                              : 'Check Out',
                        ),
                      )
                    : row['canMarkAbsent'] == true ||
                          row['canCorrectAbsence'] == true
                    ? FilledButton(
                        onPressed: _submitting.contains(row['id'])
                            ? null
                            : () => _absence(row),
                        child: Text(
                          _submitting.contains(row['id'])
                              ? 'Saving...'
                              : row['canCorrectAbsence'] == true
                              ? 'Correct Absence'
                              : 'Mark Absent',
                        ),
                      )
                    : null,
              ),
            ),
        ],
      );
    },
  );
}

class UnavailablePanel extends StatelessWidget {
  final String title;
  final String message;
  const UnavailablePanel({
    super.key,
    required this.title,
    required this.message,
  });
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(title)),
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(message, textAlign: TextAlign.center),
      ),
    ),
  );
}
