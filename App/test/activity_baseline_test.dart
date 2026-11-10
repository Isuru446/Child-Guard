import 'package:flutter/material.dart';
import 'package:final_project/core/parent_activity_summary.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/widgets/activity_baseline_card.dart';
import 'package:final_project/core/widgets/teacher_alert_card.dart';
import 'package:final_project/core/widgets/parent_routine_notifications.dart';
import 'package:final_project/core/widgets/parent_danger_notifications.dart';

void main() {
  final analysis = <String, dynamic>{
    'day': '2026-10-28',
    'state': 'LOW_ACTIVITY',
    'currentScoreMg': 40,
    'baselineScoreMg': 100,
    'reductionPercent': 60,
    'coveragePercent': 95,
    'baselineDayCount': 4,
    'requiredBaselineDays': 4,
    'policy': {'baselineDays': 7, 'reductionPercent': 30},
    'evaluatedAt': '2026-10-28T05:00:00Z',
    'latestMeasurement': {'scoreMg': 40, 'endAt': '2026-10-28T05:00:00Z'},
    'baselineCalendar': [
      {'day': '2026-10-21', 'scoreMg': 100},
      {'day': '2026-10-20', 'scoreMg': null},
    ],
  };
  test('maps server states without treating missing data as low activity', () {
    final labels = {
      'NORMAL': 'Activity looks normal',
      'BELOW_BASELINE_CANDIDATE': 'Activity is slightly lower than usual',
      'LOW_ACTIVITY': 'Low activity detected',
      'LOW_ACTIVITY_ADVISORY': 'Low activity detected',
      'BASELINE_LEARNING': 'Not enough data yet',
      'INSUFFICIENT_DATA': 'Not enough data yet',
      'SENSOR_UNAVAILABLE': 'No recent wearable activity data',
      'NOT_MONITORING': 'Not enough data yet',
    };
    for (final entry in labels.entries) {
      final summary = ParentActivitySummary({...analysis, 'state': entry.key});
      expect(summary.label, entry.value);
      if (summary.kind == 'unknown') expect(summary.relativeToday, isNull);
    }
    expect(ParentActivitySummary(analysis).relativeToday, 40);
    expect(ParentActivitySummary(analysis).trend, '60% lower than usual');
    expect(
      ParentActivitySummary({...analysis, 'baselineScoreMg': 0}).relativeToday,
      isNull,
    );
    expect(
      ParentActivitySummary({...analysis, 'currentScoreMg': double.nan})
          .relativeToday,
      isNull,
    );
  });
  testWidgets('summary comes first and technical values are collapsed', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ActivityBaselineCard(activity: analysis),
          ),
        ),
      ),
    );
    expect(find.text('Low activity detected'), findsOneWidget);
    expect(find.text('40% of usual'), findsOneWidget);
    expect(find.text('60% lower than usual'), findsOneWidget);
    expect(find.textContaining('much lower'), findsOneWidget);
    expect(find.text('Current comparable movement: 40.0 mg MAD'), findsNothing);
    await tester.ensureVisible(find.text('More details'));
    await tester.tap(find.text('More details'));
    await tester.pumpAndSettle();
    expect(
      find.text('Current comparable movement: 40.0 mg MAD'),
      findsOneWidget,
    );
    expect(find.text('Valid comparison days: 4 of 7'), findsOneWidget);
  });
  testWidgets('learning has no fabricated activity score', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ActivityBaselineCard(
              activity: {
                'state': 'BASELINE_LEARNING',
                'requiredBaselineDays': 4,
              },
            ),
          ),
        ),
      ),
    );
    expect(find.text('Not enough data yet'), findsOneWidget);
    expect(
      find.text('We are still learning the normal activity pattern.'),
      findsOneWidget,
    );
    expect(find.text('Not available yet'), findsOneWidget);
    expect(find.text('0% of usual'), findsNothing);
  });
  testWidgets('advisory is amber and excluded from the Home danger preview', (
    tester,
  ) async {
    final alert = <String, dynamic>{
      'id': 'advisory',
      'kind': 'LOW_ACTIVITY_ADVISORY',
      'child': {'id': 'c', 'name': 'Authorized Child'},
      'createdAt': '2026-10-28T05:00:00Z',
      'details': {
        'currentScoreMg': 40,
        'baselineScoreMg': 100,
        'reductionPercent': 60,
        'baselineDayCount': 4,
        'coveragePercent': 95,
      },
    };
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: Column(
              children: [
                ParentDangerNotifications(alerts: [alert], onRetry: () {}),
                ParentRoutineNotifications(
                  updates: [alert],
                  onRetry: () {},
                  onOpen: () {},
                ),
                TeacherAlertCard(alert: alert, readOnly: true),
              ],
            ),
          ),
        ),
      ),
    );
    expect(find.text('No danger alerts recorded.'), findsOneWidget);
    expect(find.text('Low movement detected'), findsNWidgets(2));
    expect(find.text('Current movement: 40 mg MAD'), findsOneWidget);
    expect(find.text('Mark as Checked'), findsNothing);
    expect(
      teacherAlertStyle('LOW_ACTIVITY_ADVISORY').background,
      const Color(0xFFFFF7E6),
    );
  });
  for (final width in [320.0, 390.0]) {
    testWidgets('activity history fits $width without overflow', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ActivityBaselineCard(activity: analysis),
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    });
  }
}
