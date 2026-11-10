import 'support/backend_fixture.dart';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/alerts/alerts_screen.dart';
import 'package:final_project/screens/attendance/attendance_record_screen.dart';
import 'package:final_project/screens/home/home_screen.dart';
import 'package:final_project/screens/map/map_screen.dart';
import 'package:final_project/screens/profile/profile_screen.dart';
import 'package:final_project/screens/profile/register_pickup_screen.dart';
import 'package:final_project/screens/teacher/pickup_verified_screen.dart';
import 'package:final_project/screens/teacher/verify_pickup_code_screen.dart';
import 'package:final_project/core/demo_pickup_code.dart';

void main() {
  testWidgets('alerts show persisted backend categories and refresh to empty', (
    tester,
  ) async {
    final fixture = useBackend(tester);
    await tester.pumpWidget(
      const MaterialApp(home: AlertsScreen(userRole: UserRole.parent)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Danger-zone alert'), findsOneWidget);
    expect(find.textContaining('Fixture Gate'), findsOneWidget);
    fixture.alerts.clear();
    await tapVisible(tester, find.byTooltip('Refresh'));
    expect(find.text('No recorded alerts.'), findsOneWidget);
    expect(find.text('Danger-zone alert'), findsNothing);
  });

  testWidgets('attendance screen shows the selected day and backend records', (
    tester,
  ) async {
    useBackend(tester);
    await tester.pumpWidget(const MaterialApp(home: AttendanceRecordScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Attendance'), findsOneWidget);
    expect(find.textContaining('Waiting for Confirmation'), findsOneWidget);
    expect(find.text('No recorded confirmation'), findsOneWidget);
    expect(find.text('Check In'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'teacher attendance shows searchable authorized student records',
    (tester) async {
      final fixture = useBackend(tester, role: 'TEACHER');
      fixture.attendance['status'] = 'PRESENT';
      fixture.attendance['canConfirm'] = false;
      await tester.pumpWidget(
        const MaterialApp(home: AttendanceRecordScreen(isTeacherView: true)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Fixture Child'), findsWidgets);
      expect(find.text('Fixture Student B'), findsOneWidget);
      await tapVisible(tester, find.text('Pending'));
      expect(find.text('Fixture Student B'), findsNothing);
      // The attendance overview remains visible above the filtered roster.
      final search = find.byType(TextField);
      await tester.ensureVisible(search);
      await tester.enterText(search, 'no match');
      await tester.pumpAndSettle();
      expect(find.text('No students found'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('home dashboard matches the compact layout without overflow', (
    tester,
  ) async {
    useBackend(tester, signedIn: true);
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
    await tester.pumpAndSettle();

    expect(find.textContaining('Good '), findsOneWidget);
    expect(find.text('Fixture Child'), findsWidgets);
    expect(find.text('Live Location'), findsOneWidget);
    expect(find.byIcon(Icons.location_on_outlined), findsOneWidget);
    expect(find.byIcon(Icons.calendar_month_outlined), findsOneWidget);
    expect(find.byIcon(Icons.notifications_none_rounded), findsOneWidget);
    expect(find.byIcon(Icons.notifications_active_rounded), findsOneWidget);
    expect(find.text("Today's Activity"), findsNothing);
    expect(find.text("Activity"), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'teacher home keeps navigation and shows danger and attendance sections',
    (tester) async {
      useBackend(tester, role: 'TEACHER');
      await tester.pumpWidget(
        const MaterialApp(home: HomeScreen(userRole: UserRole.teacher)),
      );
      await tester.pumpAndSettle();
      expect(find.text("Today's Activity"), findsNothing);
      expect(find.text('Attendance'), findsOneWidget);
      expect(find.text('Pickup'), findsOneWidget);
      expect(find.text('Danger Notifications'), findsOneWidget);
      expect(find.text('Children Attendance'), findsOneWidget);
      expect(find.text('Schedule unavailable'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('home actions open alerts, transport details, and SOS controls', (
    tester,
  ) async {
    useBackend(tester, signedIn: true);
    await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Transport'));
    await tester.tap(find.text('Transport'));
    await tester.pumpAndSettle();
    expect(find.text('School transport'), findsOneWidget);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    final alertsAction = find.text('Alerts').first;
    await tester.ensureVisible(alertsAction);
    await tester.tap(alertsAction);
    await tester.pumpAndSettle();
    expect(find.byType(AlertsScreen), findsOneWidget);

    Navigator.of(tester.element(find.byType(AlertsScreen))).pop();
    await tester.pumpAndSettle();
    final sosAction = find.text('SOS');
    await tester.ensureVisible(sosAction);
    await tester.tap(sosAction);
    await tester.pumpAndSettle();
    expect(find.text('Call Police Emergency — 119'), findsOneWidget);
    expect(find.text('Send Demo Alert'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'alerts navigate to the authenticated profile without demo transport alerts',
    (tester) async {
      useBackend(tester);
      await tester.pumpWidget(
        const MaterialApp(home: AlertsScreen(userRole: UserRole.parent)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Transport Alert'), findsNothing);
      expect(find.text('Danger-zone alert'), findsOneWidget);
      await tapVisible(tester, find.byTooltip('View profile'));
      expect(find.byType(ProfileScreen), findsOneWidget);
      expect(find.text('fixture-parent'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('valid shared pickup code opens pickup confirmation', (
    tester,
  ) async {
    useBackend(tester, signedIn: false);
    DemoPickupCode.generate();
    await tester.pumpWidget(
      const MaterialApp(
        home: VerifyPickupCodeScreen(
          studentName: 'Fixture Child',
          studentImage: '',
          pickupPersonName: 'Fixture Pickup Person',
          pickupPersonImage: '',
        ),
      ),
    );

    final verifyButton = find.text('Check Demo Code');
    await tester.ensureVisible(verifyButton);
    await tester.tap(verifyButton);
    await tester.pumpAndSettle();

    expect(find.byType(PickupVerifiedScreen), findsOneWidget);
    expect(find.text('Demo only: no child release authorized'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pickup photo button opens picker and shows selected preview', (
    tester,
  ) async {
    useBackend(tester, signedIn: false);
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    const channel = MethodChannel('child_guard/phone');
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        null,
      ),
    );
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      (call) async => Uint8List.fromList([
        0x89,
        0x50,
        0x4E,
        0x47,
        0x0D,
        0x0A,
        0x1A,
        0x0A,
        0x00,
        0x00,
        0x00,
        0x0D,
        0x49,
        0x48,
        0x44,
        0x52,
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x01,
        0x08,
        0x06,
        0x00,
        0x00,
        0x00,
        0x1F,
        0x15,
        0xC4,
        0x89,
        0x00,
        0x00,
        0x00,
        0x0B,
        0x49,
        0x44,
        0x41,
        0x54,
        0x78,
        0x9C,
        0x63,
        0x60,
        0x00,
        0x02,
        0x00,
        0x00,
        0x05,
        0x00,
        0x01,
        0xA5,
        0xF6,
        0x45,
        0x40,
        0x00,
        0x00,
        0x00,
        0x00,
        0x49,
        0x45,
        0x4E,
        0x44,
        0xAE,
        0x42,
        0x60,
        0x82,
      ]),
    );

    await tester.pumpWidget(const MaterialApp(home: RegisterPickupScreen()));
    final choosePhoto = find.text('Choose a photo');
    await tester.ensureVisible(choosePhoto);
    await tester.tap(choosePhoto);
    await tester.pumpAndSettle();
    debugDefaultTargetPlatformOverride = null;

    expect(find.text('Change photo'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is Image && widget.image is MemoryImage,
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('map and profile screens render without layout errors', (
    tester,
  ) async {
    useBackend(tester, signedIn: true);
    await tester.pumpWidget(const MaterialApp(home: MapScreen()));
    expect(find.text('Wearable Location'), findsOneWidget);
    expect(find.text('Demo Child'), findsNothing);
    await tester.pumpAndSettle();
    await tapVisible(tester, find.byTooltip('Refresh'));
    expect(find.text('No valid stored GPS position.'), findsOneWidget);

    await tester.pumpWidget(const MaterialApp(home: ProfileScreen()));
    await tester.pump();
    expect(find.text('My Child'), findsOneWidget);
    expect(find.text('Logout'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
