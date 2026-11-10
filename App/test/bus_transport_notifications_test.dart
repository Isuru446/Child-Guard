import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/widgets/parent_routine_notifications.dart';
import 'package:final_project/core/widgets/backend_panels.dart';

import 'support/backend_fixture.dart';

Map<String, dynamic> notice(String kind) => {
  'id': kind,
  'kind': kind,
  'createdAt': '2026-10-29T09:00:00Z',
  'child': {'id': BackendFixture.childId, 'name': 'Fixture Child'},
  'details': {
    'source': 'VOLATILE_BLE_INFERENCE',
    'busId': 'Fixture Bus',
    'temporary': true,
  },
};
void main() {
  for (final kind in ['BUS_BOARDED', 'BUS_EXIT_INFERRED']) {
    testWidgets(
      '$kind uses the routine card, child, Sri Lanka time and honest BLE wording',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(body: ParentRoutineCard(update: notice(kind))),
          ),
        );
        expect(
          find.text(
            kind == 'BUS_BOARDED' ? 'Child Got On Bus' : 'Child Got Off Bus',
          ),
          findsOneWidget,
        );
        expect(find.textContaining('Fixture Child'), findsOneWidget);
        expect(find.textContaining('BLE'), findsOneWidget);
        expect(
          find.textContaining('2026-10-29 14:30 (Sri Lanka)'),
          findsOneWidget,
        );
        expect(find.byIcon(Icons.directions_bus_outlined), findsOneWidget);
        expect(
          tester.widget<Icon>(find.byIcon(Icons.directions_bus_outlined)).color,
          const Color(0xFF22659B),
        );
        if (kind == 'BUS_EXIT_INFERRED') {
          expect(find.textContaining('Please verify'), findsOneWidget);
        }
      },
    );
  }
  testWidgets(
    'home routine preview shows one latest transport update and retains View All',
    (tester) async {
      var opened = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ParentRoutineNotifications(
              updates: [notice('BUS_EXIT_INFERRED'), notice('BUS_BOARDED')],
              onRetry: () {},
              onOpen: () {
                opened = true;
              },
            ),
          ),
        ),
      );
      expect(find.text('Other Notifications'), findsOneWidget);
      expect(find.text('Child Got Off Bus'), findsOneWidget);
      expect(find.text('Child Got On Bus'), findsNothing);
      await tester.tap(find.text('View All'));
      expect(opened, true);
    },
  );
  testWidgets(
    'authorized child routine feed renders transport rows once across background refresh',
    (tester) async {
      final f = useBackend(tester);
      f.respond = (request) {
        if (request.url.path.endsWith('/updates')) {
          return BackendFixture.data([notice('BUS_BOARDED')]);
        }
        return null;
      };
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ChildPanel(
              childId: BackendFixture.childId,
              section: 'updates',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Child Got On Bus'), findsOneWidget);
      await tester.pump(const Duration(seconds: 16));
      await tester.pumpAndSettle();
      expect(find.text('Child Got On Bus'), findsOneWidget);
    },
  );
}
