import 'package:flutter/material.dart';

import '../backend.dart';

String alertTime(dynamic value) {
  final date = DateTime.tryParse('$value');
  if (date == null) return 'Time not available';
  final sl = date.toUtc().add(const Duration(hours: 5, minutes: 30));
  return '${sl.year}-${sl.month.toString().padLeft(2, '0')}-${sl.day.toString().padLeft(2, '0')} ${sl.hour.toString().padLeft(2, '0')}:${sl.minute.toString().padLeft(2, '0')} (Sri Lanka)';
}

String alertValue(dynamic value, String fallback) =>
    value is String && value.trim().isNotEmpty ? value : fallback;
({String title, Color background, Color border, Color ink, IconData icon})
teacherAlertStyle(dynamic kind) => switch (kind) {
  'TAMPER_LOOP_OPEN' => (
    title: 'Wearable tamper detected',
    background: const Color(0xFFFFF1F1),
    border: const Color(0xFFF1B8B8),
    ink: const Color(0xFFB42323),
    icon: Icons.link_off,
  ),
  'DANGER_ZONE_NEAR' => (
    title: 'Danger-zone alert',
    background: const Color(0xFFFFF1F1),
    border: const Color(0xFFF1B8B8),
    ink: const Color(0xFFB42323),
    icon: Icons.warning_amber_rounded,
  ),
  'WEARABLE_CONNECTION_LOST' => (
    title: 'Wearable Connection Lost',
    background: const Color(0xFFFFF7E6),
    border: const Color(0xFFF0D39A),
    ink: const Color(0xFF8A5B00),
    icon: Icons.wifi_off,
  ),
  'GEOFENCE_OUTSIDE' => (
    title: 'Outside GPS safe area',
    background: const Color(0xFFFFF1F1),
    border: const Color(0xFFF1B8B8),
    ink: const Color(0xFFB42323),
    icon: Icons.location_off_outlined,
  ),
  'LOW_ACTIVITY' || 'LOW_ACTIVITY_ADVISORY' => (
    title: 'Low movement detected',
    background: const Color(0xFFFFF7E6),
    border: const Color(0xFFF0D39A),
    ink: const Color(0xFF8A5B00),
    icon: Icons.accessibility_new,
  ),
  _ => (
    title: 'Saved notification',
    background: const Color(0xFFF1F5F9),
    border: const Color(0xFFCBD5E1),
    ink: const Color(0xFF475569),
    icon: Icons.info_outline,
  ),
};

/// One presentation and check operation for Home groups and individual history rows.
class TeacherAlertCard extends StatefulWidget {
  final Map<String, dynamic> alert;
  final VoidCallback? onOpen, onChecked;
  final bool group;
  final bool readOnly;
  final String? description;
  const TeacherAlertCard({
    super.key,
    required this.alert,
    this.onOpen,
    this.onChecked,
    this.group = false,
    this.readOnly = false,
    this.description,
  });
  @override
  State<TeacherAlertCard> createState() => _TeacherAlertCardState();
}

class _TeacherAlertCardState extends State<TeacherAlertCard> {
  bool _saving = false;
  String? _error;
  Map<String, dynamic>? _saved;
  Future<void> _check() async {
    if (_saving || widget.readOnly || !BackendSession.instance.teacher) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await BackendSession.instance.api.request(
        '/api/v1/mobile/alerts/${Uri.encodeComponent(widget.alert['id'] as String)}/check',
        method: 'POST',
        body: {'reviewToken': widget.alert['reviewToken']},
      );
      if (result is! Map || result['checkedByMe'] != true) {
        throw const ApiFailure('The notification was not saved. Try again.');
      }
      if (mounted) {
        setState(() => _saved = Map<String, dynamic>.from(result));
        widget.onChecked?.call();
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error is ApiFailure
              ? error.message
              : 'Unable to mark this notification as checked. Try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final row = widget.alert,
        style = teacherAlertStyle(row['kind']),
        danger = row['kind'] == 'DANGER_ZONE_NEAR',
        connection = row['kind'] == 'WEARABLE_CONNECTION_LOST';
    final checked =
        _saved?['checkedByMe'] == true || row['checkedByMe'] == true;
    final checkedAt = _saved?['checkedAt'] ?? row['checkedAt'];
    final beacon = row['event']?['beacon'];
    final observed = DateTime.tryParse('${row['event']?['observedAt']}');
    final recorded = DateTime.tryParse('${row['createdAt']}');
    final showObserved =
        observed != null &&
        recorded != null &&
        observed.difference(recorded).inSeconds.abs() >= 60;
    return Material(
      color: style.background,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: style.border),
      ),
      child: InkWell(
        onTap: widget.onOpen,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(style.icon, color: style.ink),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      style.title,
                      style: TextStyle(
                        color: style.ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (widget.description != null) ...[
                Text(widget.description!),
                const SizedBox(height: 8),
              ],
              Text(
                'Child: ${alertValue(row['child']?['name'], widget.readOnly ? 'Not available' : 'Child not available')}',
              ),
              Text(
                'Wearable: ${alertValue(row['event']?['device']?['hardwareId'], widget.readOnly ? 'Not available' : 'Wearable not available')}',
              ),
              if (danger)
                Text(
                  'Beacon: ${alertValue(beacon?['name'], widget.readOnly ? 'Not available' : 'Beacon not available')}',
                ),
              if (danger)
                Text(
                  'Place: ${alertValue(beacon?['location'], widget.readOnly ? 'Not available' : 'Place not available')}',
                ),
              if (row['kind'] == 'TAMPER_LOOP_OPEN' &&
                  widget.description == null)
                Text(
                  "${row['child']?['name'] ?? 'The child'}'s wearable tamper loop was disconnected. Please check the child and ensure the wearable is attached correctly. Reconnection does not dismiss this alert.",
                ),
              if (connection) ...[
                Text(
                  'Last communication: ${alertTime(row['connection']?['lastCommunicationAt'])}',
                ),
                Text(
                  'Connection warning recorded: ${alertTime(row['connection']?['detectedAt'] ?? row['createdAt'])}',
                ),
                const Text(
                  'Wearable has stopped communicating with ChildGuard.',
                ),
              ],
              if (row['kind'] == 'LOW_ACTIVITY' ||
                  row['kind'] == 'LOW_ACTIVITY_ADVISORY')
                const Text(
                  'Recorded activity is below the usual baseline. This is not a medical assessment.',
                ),
              if (row['kind'] == 'LOW_ACTIVITY_ADVISORY') ...[
                const Text(
                  'Please check whether the child is resting, wearing the device correctly, or needs attention.',
                ),
                Text(
                  'Current movement: ${row['details']?['currentScoreMg'] ?? 'Unavailable'} mg MAD',
                ),
                Text(
                  'Personal baseline: ${row['details']?['baselineScoreMg'] ?? 'Unavailable'} mg MAD',
                ),
                Text(
                  'Reduction: ${row['details']?['reductionPercent'] ?? 'Unavailable'}%',
                ),
                Text(
                  'Valid baseline days: ${row['details']?['baselineDayCount'] ?? 'Unavailable'}',
                ),
                Text(
                  'Baseline dates: ${row['details']?['baselineWindow']?['start'] ?? 'Unavailable'} to ${row['details']?['baselineWindow']?['end'] ?? 'Unavailable'}',
                ),
                Text(
                  'Coverage: ${row['details']?['coveragePercent'] ?? 'Unavailable'}%',
                ),
                Text(
                  'Compared: ${alertTime(row['details']?['period']?['startAt'])} to ${alertTime(row['details']?['period']?['endAt'])}',
                ),
              ],
              if (row['kind'] == 'GEOFENCE_OUTSIDE')
                Text(
                  'Safe area: ${alertValue(row['details']?['zone']?['name'], 'Not available')}',
                ),
              if (!connection)
                Text(
                  '${widget.group ? 'Time' : 'Recorded'}: ${alertTime(row['createdAt'])}',
                ),
              if (!connection && !widget.group && showObserved)
                Text('Observed: ${alertTime(row['event']['observedAt'])}'),
              if (!widget.readOnly &&
                  BackendSession.instance.teacher &&
                  (danger ||
                      connection ||
                      row['kind'] == 'TAMPER_LOOP_OPEN')) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(
                      checked
                          ? Icons.check_circle_outline
                          : Icons.notifications_active_outlined,
                      color: style.ink,
                      size: 18,
                    ),
                    const SizedBox(width: 5),
                    Expanded(
                      child: Text(
                        checked ? 'Checked by you' : 'New',
                        style: TextStyle(
                          color: style.ink,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                if (checked && checkedAt != null)
                  Text('Checked at ${alertTime(checkedAt)}'),
                if (widget.group &&
                    row['uncheckedCount'] is int &&
                    row['uncheckedCount'] > 1)
                  Text('${row['uncheckedCount']} danger alerts'),
                if (!checked &&
                    row['canCheck'] == true &&
                    row['reviewToken'] is String &&
                    BackendSession.instance.teacher)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: _saving ? null : _check,
                      icon: _saving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.check),
                      label: Text(_saving ? 'Saving…' : 'Mark as Checked'),
                    ),
                  ),
              ],
              if (_error != null)
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _error!,
                        style: const TextStyle(color: Color(0xFF9B2424)),
                        semanticsLabel: 'Unable to save: $_error',
                      ),
                    ),
                    TextButton(
                      onPressed: _saving ? null : _check,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}
