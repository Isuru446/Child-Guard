import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/widgets/activity_baseline_card.dart';
import 'package:final_project/screens/history/history_screen.dart';

import 'support/backend_fixture.dart';

void main() {
  final history = jsonDecode(
    File('../backend/tests/fixtures/activity-history.contract.json')
        .readAsStringSync(),
  ) as Map<String, dynamic>;
  final activity = <String, dynamic>{
    'dailyHistory': history,
    'state': 'NOT_MONITORING',
    'sensorStatus': 'NOT_REPORTED',
    'baselineDayCount': 0,
    'currentScoreMg': null,
    'baselineScoreMg': null,
  };
  Widget view({ThemeMode mode = ThemeMode.light}) => MaterialApp(
    theme: ThemeData.light(),
    darkTheme: ThemeData.dark(),
    themeMode: mode,
    home: Scaffold(
      body: SingleChildScrollView(
        child: ActivityBaselineCard(activity: activity),
      ),
    ),
  );

  testWidgets(
    'renders shared backend values, dated sample provenance and one red recent bar',
    (tester) async {
      await tester.pumpWidget(view());
      expect(find.text('9.3 mg'), findsOneWidget);
      expect(find.text('6.2 mg'), findsOneWidget);
      expect(find.textContaining('33% below average'), findsOneWidget);
      expect(
        find.textContaining('Sample history · 2026-10-07'),
        findsOneWidget,
      );
      expect(
        find.textContaining("Demo Child's movement on October 27"),
        findsOneWidget,
      );
      expect(find.text('Movement lower than usual'), findsOneWidget);
      final redBar = find.byKey(
        const ValueKey('activity-bar-2026-10-27-belowAverage'),
      );
      final decoration =
          tester.widget<Container>(redBar).decoration as BoxDecoration;
      expect(decoration.color, const Color(0xFFD84343));
      for (final day in [21, 22, 23, 26]) {
        final normal = tester.widget<Container>(
          find.byKey(ValueKey('activity-bar-2026-10-$day-normal')),
        );
        expect(
          (normal.decoration as BoxDecoration).color,
          const Color(0xFF1683C7),
        );
      }
      expect(
        find.byKey(const ValueKey('activity-bar-2026-10-24-noData')),
        findsNothing,
      );
      expect(find.textContaining('Time-matched baseline:'), findsNothing);
    },
  );

  testWidgets('switches periods using server means and shows a tapped reading', (
    tester,
  ) async {
    await tester.pumpWidget(view());
    await tapVisible(tester, find.text('Last 21 Days'));
    expect(
      find.text(
        '21-day average: ${(history['periods']['21']['averageMg'] as num).toStringAsFixed(1)} mg',
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('activity-bar-2026-10-07-normal')),
      findsOneWidget,
    );
    await tapVisible(tester, find.text('Last 7 Days'));
    await tester.ensureVisible(
      find.byKey(const ValueKey('activity-bar-2026-10-21-normal')),
    );
    await tester.tap(
      find.byKey(const ValueKey('activity-bar-2026-10-21-normal')),
    );
    await tester.pump();
    expect(find.textContaining('10.2 mg · Normal'), findsOneWidget);
    await tapVisible(tester, find.text('More details'));
    expect(find.text('Time-matched baseline: Not available'), findsOneWidget);
    expect(
      find.text(
        'No genuine advisory recorded for the current operational day.',
      ),
      findsOneWidget,
    );
  });

  for (final width in [320.0, 390.0, 700.0]) {
    testWidgets('daily chart fits $width in light and dark modes', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final mode in [ThemeMode.light, ThemeMode.dark]) {
        await tester.pumpWidget(view(mode: mode));
        await tapVisible(tester, find.text('Last 21 Days'));
        expect(tester.takeException(), isNull);
      }
    });
  }

  testWidgets(
    'sample is an explicit child-scoped selection and can return to genuine history',
    (tester) async {
      final fixture = useBackend(tester);
      fixture.respond = (r) => r.url.path.endsWith('/activity')
          ? BackendFixture.data({
              ...activity,
              'historyPreviewAvailable': true,
              'dailyHistory': {
                ...history,
                'sourceLabel': r.url.queryParameters['source'] == 'sample'
                    ? 'Sample history'
                    : 'Recorded history',
              },
            })
          : null;
      await tester.pumpWidget(const MaterialApp(home: HistoryScreen()));
      await tester.pumpAndSettle();
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      await tapVisible(tester, find.text('Sample history'));
      expect(
        fixture.requests.any(
          (r) =>
              r.url.path.endsWith('/${BackendFixture.childId}/activity') &&
              r.url.queryParameters['source'] == 'sample',
        ),
        isTrue,
      );
      expect(find.textContaining('Sample history ·'), findsOneWidget);
      await tapVisible(tester, find.text('Recorded history'));
      expect(find.textContaining('Recorded history ·'), findsOneWidget);
    },
  );

  testWidgets(
    'disabling preview recovers genuine history without stranding the screen',
    (tester) async {
      final fixture = useBackend(tester);
      var disabled = false;
      fixture.respond = (r) {
        if (!r.url.path.endsWith('/activity')) return null;
        if (r.url.queryParameters['source'] == 'sample') {
          disabled = true;
          return BackendFixture.error(404, 'Sample unavailable');
        }
        return BackendFixture.data({
          ...activity,
          'historyPreviewAvailable': !disabled,
          'dailyHistory': {...history, 'sourceLabel': 'Recorded history'},
        });
      };
      await tester.pumpWidget(const MaterialApp(home: HistoryScreen()));
      await tester.pumpAndSettle();
      await tapVisible(tester, find.text('Sample history'));
      expect(
        find.text('Sample history is unavailable. Showing recorded history.'),
        findsOneWidget,
      );
      expect(find.textContaining('Recorded history ·'), findsOneWidget);
    },
  );
}
