import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'teacher_alert_card.dart' show alertTime;

/// Both periods and their classifications are supplied by the shared API.
/// Local arithmetic is used only to place bars on the screen.
class DailyActivityHistory extends StatefulWidget {
  final Map<String, dynamic> activity;
  const DailyActivityHistory({super.key, required this.activity});
  @override
  State<DailyActivityHistory> createState() => _DailyActivityHistoryState();
}

class _DailyActivityHistoryState extends State<DailyActivityHistory> {
  String _period = '7';
  String? _selectedDay;
  static const blue = Color(0xFF1683C7);
  static const red = Color(0xFFD84343);
  String _mg(dynamic value) => value is num && value.isFinite
      ? '${value.toStringAsFixed(1)} mg'
      : 'Not available';
  String _date(dynamic value) {
    final date = DateTime.tryParse('$value');
    if (date == null) return 'No recorded day';
    return MaterialLocalizations.of(context).formatShortDate(date);
  }

  Widget _card(Widget child) => Card(
    child: Padding(padding: const EdgeInsets.all(16), child: child),
  );
  @override
  Widget build(BuildContext context) {
    final activity = widget.activity;
    final history = activity['dailyHistory'] as Map;
    final view = history['periods'][_period] as Map;
    final seven = history['periods']['7'] as Map;
    final days = (view['days'] as List).cast<Map>();
    final latest = history['lastRecordedDay'] as Map?;
    final difference = history['percentDifference'] as num?;
    final lower = [
      'significantlyBelow',
      'slightlyBelow',
    ].contains(history['status']);
    final selected =
        days.where((d) => d['day'] == _selectedDay).firstOrNull ??
        days.lastOrNull;
    final foreground = Theme.of(context).colorScheme.onSurface;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
          child: Text(
            '${history['sourceLabel']} · ${history['start']} – ${history['end']}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        _card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(
                    backgroundColor: (lower ? red : blue).withValues(
                      alpha: 0.1,
                    ),
                    child: Icon(
                      lower
                          ? Icons.trending_down_rounded
                          : Icons.insights_outlined,
                      color: lower ? red : blue,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '${history['statusLabel']}',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: lower ? red : foreground,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text('${history['explanation']}'),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _metric(
                '7-Day Average',
                _mg(seven['averageMg']),
                '${seven['validDayCount']} valid recorded days',
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: _metric(
                'Last Recorded Day',
                _mg(latest?['scoreMg']),
                '${_date(latest?['day'])}\n${difference == null ? 'Comparison unavailable' : '${difference.abs().round()}% ${difference < 0 ? 'below' : 'above'} average'}',
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        _card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Activity trend ? ${history['sourceLabel']}',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  for (final period in ['7', '21'])
                    ChoiceChip(
                      label: Text('Last $period Days'),
                      selected: _period == period,
                      onSelected: (_) => setState(() {
                        _period = period;
                        _selectedDay = null;
                      }),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                '$_period-day average: ${_mg(view['averageMg'])}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              Text(
                '${view['validDayCount']} valid days · ${view['start']} – ${view['end']}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 16),
              _chart(days, view['averageMg'] as num?),
              const SizedBox(height: 10),
              Wrap(
                spacing: 12,
                runSpacing: 6,
                children: [
                  _legend(blue, 'Normal'),
                  _legend(red, '↓ Below average'),
                  _legend(Colors.blueGrey, '— No data / partial'),
                ],
              ),
              const SizedBox(height: 12),
              if (selected != null)
                Text(
                  '${_date(selected['day'])}: ${_mg(selected['scoreMg'])} · ${selected['statusLabel']}',
                  key: const ValueKey('activity-selected-reading'),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              const SizedBox(height: 10),
              Text(
                'Dashed line: $_period-day mean. Tap a day for its reading. Swipe to view all dates.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        _card(
          const Text(
            'The average uses only adequately monitored recorded days in the selected completed calendar period. Missing days are excluded, never counted as zero. A red bar means below the displayed daily average; it is not a safety advisory.',
          ),
        ),
        const SizedBox(height: 10),
        Card(
          child: ExpansionTile(
            title: const Text('More details'),
            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            expandedCrossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'MAD movement measurement · ${history['units']} · ${history['measurementVersion']}',
              ),
              const Text(
                'Authoritative live time-matched comparison (separate from daily chart)',
              ),
              Text(
                'Current comparable movement: ${_mg(activity['currentScoreMg'])}',
              ),
              Text(
                'Time-matched baseline: ${_mg(activity['baselineScoreMg'])}',
              ),
              Text('Comparison days: ${activity['baselineDayCount'] ?? 0}'),
              Text('Data coverage: ${_percent(activity['coveragePercent'])}'),
              Text(
                'Observation time: ${alertTime(activity['latestMeasurement']?['endAt'])}',
              ),
              Text('Evaluation time: ${alertTime(activity['evaluatedAt'])}'),
              Text(
                'Sensor quality: ${activity['sensorStatus'] ?? 'Unavailable'}',
              ),
              Text(
                'Last recorded day coverage: ${_percent(latest?['coveragePercent'])}',
              ),
              Text(
                'Last day observation: ${alertTime(latest?['observationEnd'])}',
              ),
              Text(
                'Live monitoring state: ${activity['state'] ?? 'Unavailable'}',
              ),
              Text(
                activity['alert'] == null
                    ? 'No genuine advisory recorded for the current operational day.'
                    : 'Genuine advisory recorded: ${alertTime(activity['alert']['createdAt'])}',
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _percent(dynamic value) => value is num && value.isFinite
      ? '${value.toStringAsFixed(1)}%'
      : 'Unavailable';
  Widget _metric(String title, String value, String subtitle) => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 8),
        Text(
          value,
          style: Theme.of(context).textTheme.titleLarge
              ?.copyWith(color: blue, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
      ],
    ),
  );
  Widget _legend(Color color, String text) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(Icons.circle, color: color, size: 8),
      const SizedBox(width: 5),
      Text(text, style: Theme.of(context).textTheme.bodySmall),
    ],
  );

  Widget _chart(List<Map> days, num? average) {
    final maximum = days.fold<double>(
      average?.toDouble() ?? 1,
      (v, d) => math.max(v, (d['scoreMg'] as num?)?.toDouble() ?? 0),
    );
    final scale = math.max(maximum * 1.2, 1.0);
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = math.max(constraints.maxWidth, days.length * 34.0);
        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: width,
            height: 210,
            child: Stack(
              children: [
                if (average != null)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 42 + average / scale * 160,
                    child: CustomPaint(
                      painter: _DashedMean(
                        Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                      size: Size(width, 1),
                    ),
                  ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    for (final day in days)
                      Expanded(
                        child: Semantics(
                          button: true,
                          label:
                              '${day['day']}: ${_mg(day['scoreMg'])}, ${day['statusLabel']}',
                          child: Tooltip(
                            message:
                                '${day['day']} · ${_mg(day['scoreMg'])} · ${day['statusLabel']}',
                            child: InkWell(
                              onTap: () => setState(
                                () => _selectedDay = day['day'] as String,
                              ),
                              borderRadius: BorderRadius.circular(6),
                              child: SizedBox(
                                height: 210,
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    if (day['scoreMg'] is num)
                                      Container(
                                        key: ValueKey(
                                          'activity-bar-${day['day']}-${day['classification']}',
                                        ),
                                        height: math.max(
                                          2,
                                          (day['scoreMg'] as num).toDouble() /
                                              scale *
                                              160,
                                        ),
                                        width: math.min(
                                          24,
                                          width / days.length - 8,
                                        ),
                                        decoration: BoxDecoration(
                                          color:
                                              day['classification'] ==
                                                  'belowAverage'
                                              ? red
                                              : blue,
                                          borderRadius:
                                              const BorderRadius.vertical(
                                                top: Radius.circular(5),
                                              ),
                                        ),
                                      ),
                                    if (day['scoreMg'] == null)
                                      const Icon(
                                        Icons.remove_rounded,
                                        size: 14,
                                        color: Colors.blueGrey,
                                      ),
                                    const SizedBox(height: 6),
                                    SizedBox(
                                      height: 36,
                                      child: Text(
                                        '${day['day']}'.substring(8),
                                        textAlign: TextAlign.center,
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DashedMean extends CustomPainter {
  final Color color;
  _DashedMean(this.color);
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1;
    for (double x = 0; x < size.width; x += 9) {
      canvas.drawLine(
        Offset(x, 0),
        Offset(math.min(x + 5, size.width), 0),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _DashedMean oldDelegate) =>
      oldDelegate.color != color;
}
