import 'package:flutter/material.dart';

import 'teacher_alert_card.dart';

String routineTitle(dynamic kind) => switch (kind) {
  'BUS_BOARDED' => 'Child Got On Bus',
  'BUS_EXIT_INFERRED' => 'Child Got Off Bus',
  'LOW_ACTIVITY_ADVISORY' => 'Low movement detected',
  'CHECKIN_PENDING' => 'Arrival awaiting confirmation',
  'ARRIVAL_RECORDED' => 'Arrival recorded',
  'ATTENDANCE_CONFIRMED_TEACHER' ||
  'ATTENDANCE_CONFIRMED_RFID' ||
  'ATTENDANCE_CONFIRMED_ADMIN' => 'Attendance confirmed',
  'ABSENT' => 'Absence recorded',
  'ATTENDANCE_ABSENCE_CORRECTED' => 'Absence corrected',
  'CHECKED_OUT' => 'Checked out',
  'PICKUP_REQUEST_CREATED' => 'Pickup requested',
  'PICKUP_COMPLETED' => 'Pickup completed',
  'PICKUP_CANCELLED' => 'Pickup cancelled',
  'PICKUP_REJECTED' => 'Pickup rejected',
  'PICKUP_EXPIRED' => 'Pickup request expired',
  _ => 'Child update',
};

String routineMessage(Map<String, dynamic> row) {
  final name = row['child']?['name'] ?? 'Your child';
  return switch (row['kind']) {
    'BUS_BOARDED' =>
      "$name's wearable detected the school bus beacon. Boarding is inferred from BLE proximity, not physically verified. This temporary update is lost if the backend restarts.",
    'BUS_EXIT_INFERRED' =>
      "$name's wearable stopped detecting the bus beacon during sustained healthy scanning. Exit is inferred from BLE; signal obstruction or beacon failure is also possible. Please verify the child has left the bus safely. This update is temporary.",
    'ARRIVAL_RECORDED' => '$name\'s earlier Gate arrival was recorded.',
    'ATTENDANCE_CONFIRMED_RFID' =>
      '$name was marked present using their registered RFID card.',
    'LOW_ACTIVITY_ADVISORY' =>
      "$name's measured movement has been lower than usual. Please check whether the child is resting, wearing the device correctly, or needs attention.",
    'CHECKIN_PENDING' => "$name's arrival is waiting for Teacher confirmation.",
    'ATTENDANCE_CONFIRMED_TEACHER' ||
    'ATTENDANCE_CONFIRMED_ADMIN' => "$name's attendance was confirmed.",
    'ABSENT' => 'A Teacher recorded an absence for $name.',
    'ATTENDANCE_ABSENCE_CORRECTED' =>
      "$name's absence was corrected. Arrival still needs confirmation.",
    'CHECKED_OUT' => 'A Teacher recorded that $name left for the day.',
    'PICKUP_REQUEST_CREATED' => 'A pickup request was saved for $name.',
    'PICKUP_COMPLETED' =>
      "$name's pickup was confirmed by an authorized Teacher.",
    'PICKUP_CANCELLED' => "$name's pickup request was cancelled.",
    'PICKUP_REJECTED' => "$name's pickup request was rejected.",
    'PICKUP_EXPIRED' => "$name's pickup request expired.",
    _ => 'A saved update is available for $name.',
  };
}

class ParentRoutineCard extends StatelessWidget {
  final Map<String, dynamic> update;
  const ParentRoutineCard({super.key, required this.update});
  @override
  Widget build(BuildContext context) {
    final kind = update['kind'];
    final pending =
        kind == 'CHECKIN_PENDING' ||
        kind == 'PICKUP_REQUEST_CREATED' ||
        kind == 'LOW_ACTIVITY_ADVISORY';
    final success =
        kind == 'PICKUP_COMPLETED' ||
        '$kind'.startsWith('ATTENDANCE_CONFIRMED_');
    final color = pending
        ? Colors.amber.shade900
        : success
        ? Colors.green.shade800
        : const Color(0xFF22659B);
    return Card(
      color: color.withValues(alpha: 0.06),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: color.withValues(alpha: 0.2)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              kind == 'BUS_BOARDED' || kind == 'BUS_EXIT_INFERRED'
                  ? Icons.directions_bus_outlined
                  : kind == 'LOW_ACTIVITY_ADVISORY'
                  ? Icons.insights_outlined
                  : pending
                  ? Icons.schedule
                  : success
                  ? Icons.check_circle_outline
                  : Icons.notifications_outlined,
              color: color,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    routineTitle(kind),
                    style: TextStyle(color: color, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  Text(routineMessage(update)),
                  if ((kind == 'BUS_BOARDED' || kind == 'BUS_EXIT_INFERRED') &&
                      update['details']?['busId'] is String)
                    Text('Bus: ${update['details']['busId']}'),
                  if (kind == 'LOW_ACTIVITY_ADVISORY' &&
                      update['details']?['reductionPercent'] is num &&
                      (update['details']['reductionPercent'] as num).isFinite)
                    Text(
                      'Measured movement was ${(update['details']['reductionPercent'] as num).toStringAsFixed(1)}% lower than usual.',
                    ),
                  const SizedBox(height: 4),
                  Text(
                    alertTime(update['createdAt']),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ParentRoutineNotifications extends StatelessWidget {
  final List<Map<String, dynamic>> updates;
  final bool failed, loading;
  final VoidCallback onRetry;
  final VoidCallback? onOpen;
  const ParentRoutineNotifications({
    super.key,
    this.updates = const [],
    this.failed = false,
    this.loading = false,
    required this.onRetry,
    this.onOpen,
  });
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(Icons.notifications_outlined, color: Color(0xFF22659B)),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'Other Notifications',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ),
            TextButton(onPressed: onOpen, child: const Text('View All')),
          ],
        ),
        if (loading)
          const LinearProgressIndicator()
        else if (failed)
          Row(
            children: [
              const Expanded(child: Text('Unable to load recent updates.')),
              TextButton(onPressed: onRetry, child: const Text('Retry')),
            ],
          )
        else if (updates.isEmpty)
          const ListTile(
            leading: Icon(Icons.notifications_none),
            title: Text('No recent updates.'),
          )
        else
          ParentRoutineCard(update: updates.first),
      ],
    ),
  );
}
