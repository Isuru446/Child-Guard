import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/main_wrapper.dart';
import 'package:final_project/screens/home/home_screen.dart';
import 'package:final_project/screens/profile/profile_screen.dart';
import 'package:final_project/screens/profile/account_management_screen.dart';
import 'package:final_project/screens/alerts/alerts_screen.dart';
import 'package:final_project/screens/attendance/attendance_record_screen.dart';

import 'support/backend_fixture.dart';

Future<void> tab(WidgetTester tester, String label) => tapVisible(
  tester,
  find.descendant(
    of: find.byType(BottomNavigationBar),
    matching: find.text(label),
  ),
);

void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  for (final role in [UserRole.parent, UserRole.teacher]) {
    final teacher = role == UserRole.teacher;
    final backendRole = teacher ? 'TEACHER' : 'PARENT';

    testWidgets('$backendRole menu and avatar have separate destinations', (
      tester,
    ) async {
      final fixture = useBackend(tester, role: backendRole);
      phone(tester);
      await tester.pumpWidget(
        MaterialApp(home: MainWrapperScreen(userRole: role)),
      );
      await tester.pumpAndSettle();
      await tapVisible(tester, find.byTooltip('Open menu'));
      expect(find.byType(Drawer), findsOneWidget);
      expect(
        find.text(teacher ? 'Teacher menu' : 'Parent menu'),
        findsOneWidget,
      );
      final activity = find.descendant(
        of: find.byType(Drawer),
        matching: find.text('Activity'),
      );
      expect(activity, teacher ? findsNothing : findsOneWidget);
      expect(find.byType(ProfileScreen), findsNothing);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(Drawer), findsNothing);
      await tapVisible(
        tester,
        find.byKey(const ValueKey('home-profile-avatar')),
      );
      expect(find.byType(AccountManagementScreen), findsOneWidget);
      expect(
        find.textContaining('Emergency contacts'),
        teacher ? findsNothing : findsOneWidget,
      );
      await tapVisible(tester, find.byTooltip('Back'));
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(find.byType(MainWrapperScreen), findsOneWidget);
      expect(fixture.session.signedIn, isTrue);
      await tapVisible(tester, find.byTooltip('Notifications'));
      expect(find.byType(AlertsScreen), findsOneWidget);
      await tapVisible(tester, find.byTooltip('Back'));
      expect(
        tester
            .widget<BottomNavigationBar>(find.byType(BottomNavigationBar))
            .currentIndex,
        0,
      );
      expect(fixture.requests.where((r) => r.method != 'GET'), isEmpty);
    });

    testWidgets(
      '$backendRole tab back and Android back return within the same shell',
      (tester) async {
        final fixture = useBackend(tester, role: backendRole);
        phone(tester);
        await tester.pumpWidget(
          MaterialApp(home: MainWrapperScreen(userRole: role)),
        );
        await tester.pumpAndSettle();
        await tab(tester, 'Profile');
        await tapVisible(tester, find.text('Account details and requests'));
        expect(find.byType(AccountManagementScreen), findsOneWidget);
        await tapVisible(tester, find.byTooltip('Back'));
        expect(
          tester
              .widget<BottomNavigationBar>(find.byType(BottomNavigationBar))
              .currentIndex,
          3,
        );
        await tapVisible(
          tester,
          find.widgetWithIcon(IconButton, Icons.arrow_back_ios_new_rounded),
        );
        expect(
          tester
              .widget<BottomNavigationBar>(find.byType(BottomNavigationBar))
              .currentIndex,
          0,
        );
        await tab(tester, 'Profile');
        await tab(tester, 'Alerts');
        await tapVisible(tester, find.byTooltip('Back'));
        expect(
          tester
              .widget<BottomNavigationBar>(find.byType(BottomNavigationBar))
              .currentIndex,
          3,
        );
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<BottomNavigationBar>(find.byType(BottomNavigationBar))
              .currentIndex,
          0,
        );
        expect(find.byType(MainWrapperScreen), findsOneWidget);
        expect(fixture.session.signedIn, isTrue);
      },
    );

    testWidgets(
      '$backendRole drawer attendance uses the existing role destination',
      (tester) async {
        useBackend(tester, role: backendRole);
        phone(tester);
        await tester.pumpWidget(
          MaterialApp(home: MainWrapperScreen(userRole: role)),
        );
        await tester.pumpAndSettle();
        await tapVisible(tester, find.byTooltip('Open menu'));
        await tapVisible(
          tester,
          find.descendant(
            of: find.byType(Drawer),
            matching: find.text('Attendance'),
          ),
        );
        expect(find.byType(Drawer), findsNothing);
        expect(
          tester
              .widget<AttendanceRecordScreen>(
                find.byType(AttendanceRecordScreen),
              )
              .isTeacherView,
          teacher,
        );
        await tapVisible(
          tester,
          find.widgetWithIcon(IconButton, Icons.arrow_back_ios_new_rounded),
        );
        expect(find.byType(HomeScreen), findsOneWidget);
      },
    );

    testWidgets(
      '$backendRole standalone account Back returns to the trusted role Home',
      (tester) async {
        final fixture = useBackend(tester, role: backendRole);
        phone(tester);
        await tester.pumpWidget(
          const MaterialApp(home: AccountManagementScreen()),
        );
        await tester.pumpAndSettle();
        await tapVisible(tester, find.byTooltip('Back'));
        expect(
          tester
              .widget<MainWrapperScreen>(find.byType(MainWrapperScreen))
              .userRole,
          role,
        );
        expect(fixture.session.signedIn, isTrue);
      },
    );

    testWidgets(
      '$backendRole pushed Alerts Back follows the original route and changes no alert state',
      (tester) async {
        final fixture = useBackend(tester, role: backendRole);
        phone(tester);
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => AlertsScreen(userRole: role),
                    ),
                  ),
                  child: const Text('Original screen'),
                ),
              ),
            ),
          ),
        );
        await tapVisible(tester, find.text('Original screen'));
        expect(find.byType(AlertsScreen), findsOneWidget);
        await tapVisible(tester, find.byTooltip('Back'));
        expect(find.text('Original screen'), findsOneWidget);
        expect(find.byType(MainWrapperScreen), findsNothing);
        expect(fixture.requests.where((r) => r.method != 'GET'), isEmpty);
        expect(fixture.session.signedIn, isTrue);
      },
    );
    testWidgets('$backendRole root Alerts Android Back returns to its Home', (
      tester,
    ) async {
      final fixture = useBackend(tester, role: backendRole);
      phone(tester);
      await tester.pumpWidget(MaterialApp(home: AlertsScreen(userRole: role)));
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<MainWrapperScreen>(find.byType(MainWrapperScreen))
            .userRole,
        role,
      );
      expect(fixture.session.signedIn, isTrue);
      expect(fixture.requests.where((r) => r.method != 'GET'), isEmpty);
    });
  }

  testWidgets(
    'Teacher profile hides contacts but saves the loaded contacts unchanged',
    (tester) async {
      final fixture = useBackend(tester, role: 'TEACHER');
      final contacts = [
        {
          'name': 'Saved Adult',
          'phone': '0771111111',
          'relationship': 'Family',
        },
      ];
      fixture.accountProfile['emergencyContacts'] = contacts;
      await tester.pumpWidget(
        const MaterialApp(home: AccountManagementScreen()),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Emergency contacts'), findsNothing);
      expect(find.text('Add emergency contact'), findsNothing);
      expect(find.text('Remove contact'), findsNothing);
      for (final label in [
        'Full name',
        'Email address',
        'Phone number',
        'Replace profile photo',
        'Change password',
        'Refresh',
      ]) {
        expect(find.text(label), findsOneWidget);
      }
      await tapVisible(tester, find.text('Save profile'));
      final save = fixture.requests.singleWhere(
        (r) => r.method == 'PATCH' && r.url.path == '/api/v1/mobile/profile',
      );
      expect(jsonDecode(save.body)['emergencyContacts'], contacts);
      expect(fixture.accountProfile['emergencyContacts'], contacts);
      await tapVisible(tester, find.text('Change password'));
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      final before = fixture.requests
          .where(
            (r) => r.url.path == '/api/v1/mobile/profile' && r.method == 'GET',
          )
          .length;
      await tapVisible(tester, find.text('Refresh'));
      expect(
        fixture.requests
            .where(
              (r) =>
                  r.url.path == '/api/v1/mobile/profile' && r.method == 'GET',
            )
            .length,
        greaterThan(before),
      );
    },
  );

  testWidgets('Parent profile keeps emergency contact controls', (
    tester,
  ) async {
    final fixture = useBackend(tester);
    fixture.accountProfile['emergencyContacts'] = [
      {'name': 'Saved Adult', 'phone': '0771111111', 'relationship': 'Family'},
    ];
    await tester.pumpWidget(const MaterialApp(home: AccountManagementScreen()));
    await tester.pumpAndSettle();
    expect(
      find.text('Emergency contacts (persisted with your profile)'),
      findsOneWidget,
    );
    expect(find.text('Add emergency contact'), findsOneWidget);
    expect(find.text('Remove contact'), findsOneWidget);
  });
  testWidgets(
    'Teacher cannot save before the existing profile and contacts load',
    (tester) async {
      final fixture = useBackend(tester, role: 'TEACHER');
      fixture.accountProfile['emergencyContacts'] = [
        {
          'name': 'Saved Adult',
          'phone': '0771111111',
          'relationship': 'Family',
        },
      ];
      fixture.respond = (r) => r.url.path == '/api/v1/mobile/profile'
          ? BackendFixture.error(503, 'Unavailable')
          : null;
      await tester.pumpWidget(
        const MaterialApp(home: AccountManagementScreen()),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<ElevatedButton>(
              find.widgetWithText(ElevatedButton, 'Save profile'),
            )
            .onPressed,
        isNull,
      );
      expect(fixture.requests.where((r) => r.method == 'PATCH'), isEmpty);
      expect((fixture.accountProfile['emergencyContacts'] as List).length, 1);
    },
  );

  testWidgets(
    'Teacher student list comes before the lower attendance action roster',
    (tester) async {
      final fixture = useBackend(tester, role: 'TEACHER');
      fixture.respond = (request) =>
          request.url.path == '/api/v1/attendance/roster'
          ? BackendFixture.data([
              {
                'id': 'action-row',
                'attendanceId': null,
                'child': {
                  'id': BackendFixture.childId,
                  'name': 'Fixture Child',
                },
                'day': '2026-10-29',
                'status': 'NO_RECORD',
                'canMarkAbsent': true,
              },
            ])
          : null;
      await tester.pumpWidget(
        const MaterialApp(home: AttendanceRecordScreen(isTeacherView: true)),
      );
      await tester.pumpAndSettle();
      expect(
        tester.getTopLeft(find.text('Student list')).dy,
        lessThan(tester.getTopLeft(find.text("Today's Attendance Actions")).dy),
      );
      expect(
        fixture.requests.where(
          (r) => r.url.path == '/api/v1/attendance/roster',
        ),
        hasLength(1),
      );
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Mark Absent'),
      );
      await tapVisible(tester, find.widgetWithText(TextButton, 'Cancel'));
      expect(fixture.requests.where((r) => r.method == 'POST'), isEmpty);
    },
  );

  for (final width in [320.0, 390.0]) {
    for (final role in [UserRole.parent, UserRole.teacher]) {
      testWidgets(
        '${role.name} profile and Alerts headers fit at $width with the keyboard',
        (tester) async {
          final fixture = useBackend(
            tester,
            role: role == UserRole.teacher ? 'TEACHER' : 'PARENT',
          );
          if (role == UserRole.parent) {
            fixture.accountProfile['emergencyContacts'] = [
              {
                'name': 'Saved Adult',
                'phone': '0771111111',
                'relationship': 'Family',
              },
            ];
          }
          tester.view.physicalSize = Size(width, 740);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          await tester.pumpWidget(
            const MaterialApp(home: AccountManagementScreen()),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.byType(TextFormField).first);
          tester.view.viewInsets = const FakeViewPadding(bottom: 280);
          addTearDown(tester.view.resetViewInsets);
          await tester.pumpAndSettle();
          await tester.ensureVisible(find.text('Save profile'));
          expect(tester.takeException(), isNull);
          tester.view.resetViewInsets();
          await tester.pumpWidget(
            MaterialApp(home: AlertsScreen(userRole: role)),
          );
          await tester.pumpAndSettle();
          expect(find.byTooltip('Back'), findsOneWidget);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
