import 'daily_activity_history.dart';

import 'package:flutter/material.dart';

import '../parent_activity_summary.dart';
import 'teacher_alert_card.dart' show alertTime;

String movementNumber(dynamic value, {String unit = ' mg MAD'}) =>
    value is num && value.isFinite
    ? '${value.toStringAsFixed(1)}$unit'
    : 'Unavailable';

class ActivityBaselineCard extends StatelessWidget {
  final Map<String, dynamic> activity;
  const ActivityBaselineCard({super.key, required this.activity});

  Color _color(String kind) => switch (kind) {
    'normal' || 'Normal' => const Color(0xFF2E7D32),
    'slightlyLow' || 'Slightly low' => const Color(0xFFB87500),
    'low' || 'Low' => const Color(0xFFD84343),
    _ => const Color(0xFF22659B),
  };

  @override
  Widget build(BuildContext context) {
    if (activity['dailyHistory'] is Map) {
      return DailyActivityHistory(activity: activity);
    }
    final summary = ParentActivitySummary(activity);
    final color = _color(summary.kind);
    final relative = summary.relativeToday;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Recent movement'),
                const SizedBox(height: 10),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CircleAvatar(
                      backgroundColor: color.withValues(alpha: 0.1),
                      child: Icon(Icons.insights_outlined, color: color),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        summary.label,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(
                              color: color,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(summary.message),
                const SizedBox(height: 14),
                _value(
                  'Current compared movement',
                  relative == null
                      ? 'Not available yet'
                      : '${relative.round()}% of usual',
                ),
                _value(
                  'Personal time-matched average',
                  relative == null
                      ? (summary.learning
                            ? 'Learning pattern'
                            : 'Comparison unavailable')
                      : '100% (usual level)',
                ),
                _value('Trend', summary.trend),
                const SizedBox(height: 8),
                const Text(
                  'Compares the most recently evaluated movement with matching periods in recent history. This is separate from the daily history average.',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        const Card(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              'Daily history is not available yet. We are still learning the normal activity pattern.',
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ExpansionTile(
            title: const Text('More details'),
            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            expandedCrossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Current comparable movement: ${movementNumber(activity['currentScoreMg'])}',
              ),
              Text(
                'Personal baseline: ${movementNumber(activity['baselineScoreMg'])}',
              ),
              Text(
                'Reduction: ${movementNumber(activity['reductionPercent'], unit: '%')}',
              ),
              Text(
                'Valid comparison days: ${activity['baselineDayCount'] ?? 'Unavailable'} of ${activity['policy']?['baselineDays'] ?? 7}',
              ),
              Text(
                'Coverage: ${movementNumber(activity['coveragePercent'], unit: '%')}',
              ),
              Text(
                'Latest movement: ${movementNumber(activity['latestMeasurement']?['scoreMg'])}',
              ),
              Text(
                'Sensor coverage: ${movementNumber(activity['latestMeasurement']?['coveragePercent'], unit: '%')}',
              ),
              Text(
                'Measured: ${alertTime(activity['latestMeasurement']?['endAt'])}',
              ),
              Text('Evaluated: ${alertTime(activity['evaluatedAt'])}'),
              Text('Monitoring state: ${activity['state'] ?? 'Unavailable'}'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _value(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Wrap(
      spacing: 8,
      children: [
        Text('$label:'),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
      ],
    ),
  );
}
