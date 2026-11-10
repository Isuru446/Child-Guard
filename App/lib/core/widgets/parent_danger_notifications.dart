import 'package:flutter/material.dart';

import 'teacher_alert_card.dart';

/// Presentation only. Reads, lifecycle and child isolation belong to ChildPanel's
/// existing BackendFeed, not a second polling/notification service.
class ParentDangerNotifications extends StatelessWidget {
  final List<Map<String, dynamic>> alerts;
  final bool failed, loading;
  final VoidCallback onRetry;
  final VoidCallback? onOpenAlerts;
  const ParentDangerNotifications({
    super.key,
    this.alerts = const [],
    this.failed = false,
    this.loading = false,
    required this.onRetry,
    this.onOpenAlerts,
  });

  @override
  Widget build(BuildContext context) {
    final danger =
        alerts
            .where(
              (row) => [
                'DANGER_ZONE_NEAR',
                'GEOFENCE_OUTSIDE',
                'TAMPER_LOOP_OPEN',
              ].contains(row['kind']),
            )
            .toList()
          ..sort((a, b) {
            final time =
                (DateTime.tryParse('${b['createdAt']}') ?? DateTime(1970))
                    .compareTo(
                      DateTime.tryParse('${a['createdAt']}') ?? DateTime(1970),
                    );
            return time != 0 ? time : '${b['id']}'.compareTo('${a['id']}');
          });
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.shield_outlined, color: Color(0xFFB42323)),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Danger Notifications',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
              ),
              TextButton(
                onPressed: onOpenAlerts,
                child: const Text('View All'),
              ),
            ],
          ),
          if (loading)
            const LinearProgressIndicator()
          else if (failed)
            Row(
              children: [
                const Expanded(
                  child: Text('Unable to load danger notifications.'),
                ),
                TextButton(onPressed: onRetry, child: const Text('Retry')),
              ],
            )
          else if (danger.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Row(
                children: [
                  Icon(Icons.verified_user_outlined, color: Color(0xFF2F6F8D)),
                  SizedBox(width: 8),
                  Expanded(child: Text('No danger alerts recorded.')),
                ],
              ),
            )
          else
            TeacherAlertCard(
              key: ValueKey(danger.first['id']),
              alert: danger.first,
              readOnly: true,
              description: switch (danger.first['kind']) {
                'TAMPER_LOOP_OPEN' =>
                  "${danger.first['child']?['name'] ?? 'Your child'}'s wearable tamper loop was disconnected. Please check the child and ensure the wearable is attached correctly.",
                'DANGER_ZONE_NEAR' =>
                  '${danger.first['child']?['name'] ?? 'Your child'} was detected near a restricted area.',
                'GEOFENCE_OUTSIDE' => 'A recorded location was outside the configured GPS safe area.',
                _ => 'A saved safety alert was recorded.',
              },
            ),
        ],
      ),
    );
  }
}
