import 'dart:convert';
import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:final_project/core/backend.dart';
import 'package:final_project/core/pickup_api.dart';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:final_project/core/phone_actions.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/alerts/sos_alert_screen.dart';
import 'package:final_project/screens/pickup/pickup_screen.dart';
import 'package:final_project/screens/teacher/verify_pickup_code_screen.dart';

import 'support/backend_fixture.dart';
import 'support/pickup_fixture.dart';

void main() {
  test('a late photo-upload 401 cannot sign out a newer session', () async {
    final response = Completer<http.Response>();
    final api = ApiClient(client: MockClient((_) => response.future))
      ..token = 'old-memory-token';
    var unauthorized = false;
    api.onUnauthorized = () async {
      unauthorized = true;
    };
    final pending = PickupApi(api: api)
        .upload(BackendFixture.childId, pickupPng);
    final expected = expectLater(
      pending,
      throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 401)),
    );
    api.token = 'new-memory-token';
    response.complete(BackendFixture.error(401, 'Expired'));
    await expected;
    expect(unauthorized, isFalse);
    expect(api.token, 'new-memory-token');
    api.close();
  });
  test('pickup timestamps use the Sri Lanka operational date', () {
    expect(pickupTime('2026-10-25T18:30:00Z'), '2026-10-26 00:00 (Sri Lanka)');
    expect(pickupTime(null), 'Unavailable');
    expect(pickupTime('invalid'), 'Unavailable');
  });
  testWidgets(
    'Teacher rejection validates a reason and persists the terminal state',
    (tester) async {
      final backend = useBackend(tester, role: 'TEACHER');
      final pickup = PickupFixture(backend);
      await tester.pumpWidget(
        const MaterialApp(
          home: PickupDetailScreen(id: PickupFixture.requestId),
        ),
      );
      await tester.pumpAndSettle();
      await tapVisible(tester, find.text('Reject request'));
      await tapVisible(tester, find.widgetWithText(TextButton, 'Reject'));
      expect(find.textContaining('Enter a short reason'), findsOneWidget);
      expect(pickup.requests.single['status'], 'PENDING');
      await tester.enterText(
        find.byType(TextFormField),
        'Identification does not match',
      );
      await tapVisible(tester, find.widgetWithText(TextButton, 'Reject'));
      expect(pickup.requests.single['status'], 'REJECTED');
      expect(
        find.textContaining('Identification does not match'),
        findsOneWidget,
      );
    },
  );
  testWidgets('Parent edits a saved person and can replace the private photo', (
    tester,
  ) async {
    final backend = useBackend(tester);
    final pickup = PickupFixture(backend);
    await tester.pumpWidget(
      MaterialApp(
        home: PickupPersonForm(
          child: backend.children.first,
          person: pickup.person,
          pickPhoto: (_) async => XFile.fromData(
            pickupPng,
            mimeType: 'image/png',
            name: 'replacement.png',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Full name'),
      'Edited pickup name',
    );
    await tapVisible(tester, find.text('Gallery'));
    await tapVisible(tester, find.text('Save pickup person'));
    expect(pickup.person['fullName'], 'Edited pickup name');
    expect(
      backend.requests.where(
        (r) =>
            r.method == 'PATCH' && r.url.path.endsWith(PickupFixture.personId),
      ),
      hasLength(1),
    );
    expect(
      backend.requests.where((r) => r.url.path.endsWith('/photos')),
      hasLength(1),
    );
  });
  testWidgets('119 dialer needs no backend and never automatically calls', (
    tester,
  ) async {
    final backend = useBackend(tester, role: 'TEACHER');
    backend.respond = (_) => BackendFixture.error(503, 'offline');
    final intents = <MethodCall>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      PhoneActions.channel,
      (call) async {
        intents.add(call);
        return true;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        PhoneActions.channel,
        null,
      ),
    );
    await tester.pumpWidget(
      const MaterialApp(home: SosAlertScreen(userRole: UserRole.teacher)),
    );
    await tester.pumpAndSettle();
    expect(intents, isEmpty);
    expect(backend.requests, isEmpty);
    await tapVisible(tester, find.text('Call Police Emergency — 119'));
    expect(intents.single.method, 'dial');
    expect(intents.single.arguments, '119');
    expect(backend.requests, isEmpty);
    expect(
      find.textContaining('no call completion is confirmed'),
      findsOneWidget,
    );
  });
  testWidgets('missing dialer does not crash or claim emergency dispatch', (
    tester,
  ) async {
    useBackend(tester);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      PhoneActions.channel,
      (_) async => false,
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        PhoneActions.channel,
        null,
      ),
    );
    await tester.pumpWidget(const MaterialApp(home: SosAlertScreen()));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Call Police Emergency — 119'));
    expect(
      find.text('Phone dialer unavailable on this device. No call was placed.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'Teacher child selection loads only selected Parent phone and handles missing numbers',
    (tester) async {
      final backend = useBackend(tester, role: 'TEACHER');
      PickupFixture(backend);
      final intents = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        PhoneActions.channel,
        (call) async {
          intents.add(call);
          return true;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          PhoneActions.channel,
          null,
        ),
      );
      await tester.pumpWidget(const MaterialApp(home: ParentCallScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Fixture Parent'), findsOneWidget);
      await tapVisible(tester, find.byTooltip('Call Parent'));
      expect(intents.single.arguments, '+94771234567');
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Fixture Student B').last);
      await tester.pumpAndSettle();
      expect(find.textContaining('Phone number unavailable'), findsOneWidget);
      expect(find.text('Fixture Parent'), findsNothing);
      expect(
        tester
            .widget<IconButton>(
              find.widgetWithIcon(IconButton, Icons.call_outlined),
            )
            .onPressed,
        isNull,
      );
      expect(
        backend.requests.any(
          (r) => r.url.path.endsWith(
            '${BackendFixture.otherChildId}/parent-contacts',
          ),
        ),
        isTrue,
      );
    },
  );
  testWidgets(
    'Parent form requires photo then uploads and saves the selected child',
    (tester) async {
      final backend = useBackend(tester);
      final pickup = PickupFixture(backend, pending: false);
      await tester.pumpWidget(
        MaterialApp(
          home: PickupPersonForm(
            child: backend.children.first,
            pickPhoto: (_) async => XFile.fromData(
              pickupPng,
              mimeType: 'image/png',
              name: 'fixture.png',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Full name'),
        'Saved pickup name',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Residential address'),
        '12 Real Address Road',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Phone number'),
        '077 123 4567',
      );
      await tapVisible(tester, find.text('Save pickup person'));
      expect(find.text('Select a real photograph.'), findsOneWidget);
      expect(backend.requests, isEmpty);
      await tapVisible(tester, find.text('Gallery'));
      await tapVisible(tester, find.text('Save pickup person'));
      final upload = backend.requests.singleWhere(
        (r) => r.url.path.endsWith('/photos'),
      );
      expect(upload.bodyBytes, pickupPng);
      expect(upload.headers['Content-Type'], 'image/png');
      expect(pickup.person['fullName'], 'Saved pickup name');
      expect(pickup.person['childId'], BackendFixture.childId);
    },
  );
  testWidgets(
    'Parent requests pickup and SMS/share open composers without delivery claims',
    (tester) async {
      final backend = useBackend(tester);
      final pickup = PickupFixture(backend, pending: false);
      final intents = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        PhoneActions.channel,
        (call) async {
          intents.add(call);
          return true;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          PhoneActions.channel,
          null,
        ),
      );
      await tester.pumpWidget(const MaterialApp(home: PickupScreen()));
      await tester.pumpAndSettle();
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Request Pickup'),
      );
      await tapVisible(tester, find.text('Fixture Pickup Person').last);
      expect(backend.requests.where((r) => r.method == 'POST'), isEmpty);
      await tapVisible(tester, find.widgetWithText(FilledButton, 'Confirm'));
      expect(pickup.requests, hasLength(1));
      expect(find.text('Pickup authorization issued'), findsOneWidget);
      await tapVisible(tester, find.text('Send SMS'));
      expect(intents.last.method, 'sms');
      expect((intents.last.arguments as Map)['phone'], '0771234567');
      expect((intents.last.arguments as Map)['message'], contains('654321'));
      expect(find.textContaining('delivery is not confirmed'), findsOneWidget);
      await tapVisible(tester, find.text('Share Message'));
      expect(intents.last.method, 'share');
      await tapVisible(tester, find.text('Copy Code'));
      expect(find.text('Pickup authorization issued'), findsOneWidget);
    },
  );
  testWidgets(
    'Teacher verifies photo and provided code before explicit physical handover',
    (tester) async {
      final backend = useBackend(tester, role: 'TEACHER');
      final pickup = PickupFixture(backend);
      await tester.pumpWidget(
        const MaterialApp(
          home: PickupDetailScreen(id: PickupFixture.requestId),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('654321'), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Verify pickup code'),
            )
            .onPressed,
        isNull,
      );
      await tapVisible(
        tester,
        find.text('I compared the saved photo and checked identification'),
      );
      await tester.enterText(find.byType(TextField), '000000');
      await tapVisible(tester, find.text('Verify pickup code'));
      expect(find.text('Code not accepted'), findsOneWidget);
      await tester.enterText(find.byType(TextField), '654321');
      await tapVisible(tester, find.text('Verify pickup code'));
      expect(pickup.requests.single['status'], 'PENDING');
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Confirm physical handover'),
            )
            .onPressed,
        isNull,
      );
      await tapVisible(
        tester,
        find.text(
          'I am physically handing this child to the identified pickup person',
        ),
      );
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Confirm physical handover'),
      );
      expect(pickup.requests.single['status'], 'PENDING');
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Complete pickup'),
      );
      expect(pickup.requests.single['status'], 'COMPLETED');
      expect(
        find.textContaining('Reviewed by: fixture-teacher'),
        findsOneWidget,
      );
      expect(
        jsonDecode(
          backend.requests
              .singleWhere((r) => r.url.path.endsWith('/complete'))
              .body,
        ),
        {
          'handoverToken': pickup.handoverToken,
          'identityChecked': true,
          'physicalHandover': true,
        },
      );
    },
  );
  testWidgets('Parent cancellation refreshes persisted status', (tester) async {
    final backend = useBackend(tester);
    final pickup = PickupFixture(backend);
    await tester.pumpWidget(
      const MaterialApp(home: PickupDetailScreen(id: PickupFixture.requestId)),
    );
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Cancel pending request'));
    expect(pickup.requests.single['status'], 'CANCELLED');
    expect(find.textContaining('Fixture Child · CANCELLED'), findsOneWidget);
    expect(find.text('Cancel pending request'), findsNothing);
  });
  testWidgets(
    'authenticated legacy demo OTP redirects to real requests without prefilled codes',
    (tester) async {
      final backend = useBackend(tester, role: 'TEACHER');
      PickupFixture(backend);
      await tester.pumpWidget(
        const MaterialApp(home: VerifyPickupCodeScreen()),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PickupScreen), findsOneWidget);
      expect(find.text('Check Demo Code'), findsNothing);
      expect(find.byType(TextField), findsNothing);
    },
  );
  testWidgets('undeployed migration gives a truthful unavailable state', (
    tester,
  ) async {
    final backend = useBackend(tester);
    PickupFixture(backend).installed = false;
    await tester.pumpWidget(const MaterialApp(home: PickupScreen()));
    await tester.pumpAndSettle();
    expect(find.textContaining('approved pickup setup'), findsOneWidget);
    expect(find.text('Request Pickup'), findsNothing);
  });
  testWidgets('pickup and SOS scroll on small Android sizes', (tester) async {
    final backend = useBackend(tester);
    PickupFixture(backend);
    tester.view.physicalSize = const Size(360, 560);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MaterialApp(home: PickupScreen()));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const MaterialApp(home: SosAlertScreen()));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
