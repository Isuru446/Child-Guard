import 'dart:convert';

import 'package:final_project/core/app_language_controller.dart';
import 'package:final_project/core/app_theme_controller.dart';
import 'package:final_project/core/backend.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class MemoryTokenStore implements TokenStore {
  String? token;
  @override
  Future<String?> read() async => token;
  @override
  Future<void> write(String token) async => this.token = token;
  @override
  Future<void> delete() async => token = null;
}

/// All identities and responses in this file exist only in widget-test memory.
/// Unexpected requests fail explicitly rather than reaching any network.
class BackendFixture {
  static const centerId = '00000000-0000-4000-8000-000000000003';
  static const centerName = 'Synthetic Test Center';
  static http.Response centersResponse() => data([
    {'id': centerId, 'name': centerName},
  ]);
  static const childId = '00000000-0000-4000-8000-000000000001';
  static const otherChildId = '00000000-0000-4000-8000-000000000002';
  final String role;
  final store = MemoryTokenStore();
  final requests = <http.Request>[];
  final unexpectedRequests = <String>[];
  final children = <Map<String, dynamic>>[];
  final alerts = <Map<String, dynamic>>[];
  late final Map<String, dynamic> profile;
  late final Map<String, dynamic> attendance;
  Map<String, dynamic> accountProfile = {
    'fullName': 'Fixture Account',
    'email': 'fixture@example.invalid',
    'phone': '0700000000',
    'emergencyContacts': <dynamic>[],
  };
  late final BackendSession session;
  http.Response? Function(http.Request)? respond;
  Future<http.Response?> Function(http.Request)? respondAsync;
  late final BackendSession _previous;

  BackendFixture({this.role = 'PARENT', bool signedIn = true}) {
    profile = {
      'id': 'fixture-user',
      'username': 'fixture-${role.toLowerCase()}',
      'role': role,
      'centerId': 'fixture-center',
      'center': {'id': 'fixture-center', 'name': 'Fixture daycare'},
    };
    children.add({
      'id': childId,
      'name': 'Fixture Child',
      'centerId': 'fixture-center',
    });
    if (role == 'TEACHER') {
      children.add({
        'id': otherChildId,
        'name': 'Fixture Student B',
        'centerId': 'fixture-center',
      });
    }
    attendance = {
      'id': 'fixture-attendance',
      'childId': childId,
      'day': '2026-10-23',
      'child': {'id': childId, 'name': 'Fixture Child'},
      'status': 'CHECKIN_PENDING',
      'canConfirm': role == 'TEACHER',
      'attendanceEpoch': 'fixture-epoch',
      'confirmations': <dynamic>[],
    };
    alerts.add({
      'id': 'fixture-alert',
      'child': {'id': childId, 'name': 'Fixture Child'},
      'kind': 'DANGER_ZONE_NEAR',
      'createdAt': '2026-10-23T06:00:00Z',
      'event': {
        'eventType': 'DANGER_ZONE_NEAR',
        'device': {'hardwareId': 'HISTORIC-BELT'},
        'beacon': {'name': 'Fixture Gate', 'location': 'Entrance'},
      },
    });
    final api = ApiClient(
      enableStreams: false,
      client: MockClient((request) async {
        requests.add(request);
        return await respondAsync?.call(request) ??
            respond?.call(request) ??
            _response(request);
      }),
    );
    session = BackendSession(api: api, store: store);
    if (signedIn) {
      api.token = 'fixture-token';
      store.token = 'fixture-token';
      session.user = profile;
    }
    _previous = BackendSession.replaceForTesting(session);
    backendTab.value = 0;
    AppLanguageController.setLanguage('en');
    AppThemeController.themeMode.value = ThemeMode.light;
  }

  static http.Response data(dynamic value) =>
      http.Response(jsonEncode({'data': value}), 200);
  static http.Response error(int status, String message) => http.Response(
    jsonEncode({
      'error': {'message': message},
    }),
    status,
  );

  http.Response _response(http.Request request) {
    final path = request.url.path;
    if (path == '/api/v1/registration/centers') return centersResponse();
    if (path == '/api/v1/auth/login' && request.method == 'POST') {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      if (body['username'] != profile['username'] ||
          body['password'] != 'fixture-password') {
        return error(401, 'Invalid credentials');
      }
      return data({
        'token': 'fixture-token',
        'user': profile,
        'expiresIn': 3600,
      });
    }
    if (request.headers['Authorization'] != 'Bearer fixture-token') {
      return error(401, 'Sign in required');
    }
    if (path == '/api/v1/auth/me') {
      return data(profile);
    }
    if (path == '/api/v1/account/profile' || path == '/api/v1/mobile/profile') {
      if (request.method == 'PATCH') {
        accountProfile = Map<String, dynamic>.from(
          jsonDecode(request.body) as Map,
        );
        return data(accountProfile);
      }
      return data({
        ...profile,
        'profile': accountProfile,
        'profileAvailable': true,
        'registrationEnabled': true,
      });
    }
    if (path == '/api/v1/account/requests') {
      return data({'children': [], 'wearables': []});
    }
    if ((path == '/api/v1/account/password' ||
            path == '/api/v1/mobile/password') &&
        request.method == 'POST') {
      final body = jsonDecode(request.body) as Map;
      return body['currentPassword'] == 'fixture-password'
          ? data({'changed': true})
          : error(422, 'Current password is incorrect');
    }
    if (path == '/api/v1/mobile/children') return data(children);
    if (path == '/api/v1/mobile/alerts/danger-groups') {
      return role == 'TEACHER'
          ? data(
              alerts
                  .where(
                    (a) =>
                        [
                          'DANGER_ZONE_NEAR',
                          'TAMPER_LOOP_OPEN',
                        ].contains(a['kind']) &&
                        a['checkedByMe'] != true,
                  )
                  .toList(),
            )
          : error(403, 'Center Teacher required');
    }
    if (path == '/api/v1/mobile/alerts') {
      return role == 'TEACHER'
          ? data(
              alerts.where((a) => a['kind'] != 'BEACON_SIGNAL_LOST').toList(),
            )
          : error(403, 'Center Teacher required');
    }
    if (path == '/api/v1/attendance/roster' || path == '/api/v1/attendance') {
      return data([attendance]);
    }
    if (path == '/api/v1/attendance/fixture-attendance/confirm' &&
        request.method == 'POST') {
      if (role != 'TEACHER') return error(403, 'Role not permitted');
      attendance['status'] = 'PRESENT';
      attendance['canConfirm'] = false;
      return data(attendance);
    }
    final match = RegExp(
      r'^/api/v1/mobile/children/([^/]+)(?:/(attendance|alerts|updates|device|activity|location))?$',
    ).firstMatch(path);
    if (match != null) {
      final found = children.where((c) => c['id'] == match.group(1));
      if (found.isEmpty) return error(404, 'Child not found');
      switch (match.group(2)) {
        case null:
          return data(found.first);
        case 'attendance':
          return data([
            {
              ...attendance,
              'day': request.url.queryParameters['day'] ?? attendance['day'],
            },
          ]);
        case 'updates':
          return data([]);
        case 'alerts':
          final kind = request.url.queryParameters['kind'];
          final rows = alerts
              .where(
                (row) =>
                    row['kind'] != 'BEACON_SIGNAL_LOST' &&
                    (kind == null || row['kind'] == kind) &&
                    (request.url.queryParameters['category'] != 'safety' ||
                        [
                          'DANGER_ZONE_NEAR',
                          'GEOFENCE_OUTSIDE',
                          'TAMPER_LOOP_OPEN',
                          'LOW_ACTIVITY',
                        ].contains(row['kind'])),
              )
              .toList();
          final offset =
              int.tryParse(request.url.queryParameters['offset'] ?? '0') ?? 0;
          final limit =
              int.tryParse(request.url.queryParameters['limit'] ?? '25') ?? 25;
          return data(rows.skip(offset).take(limit).toList());
        case 'device':
          return data({
            'id': 'fixture-device',
            'hardwareId': 'FIXTURE-WEARABLE',
            'active': true,
            'lastSeen': '2026-10-23T06:00:00Z',
            'connectionState': 'OFFLINE',
            'batteryPercent': null,
          });
        case 'location':
          return data({
            'child': found.first,
            'device': null,
            'gpsMonitoring': {
              'latestStatus': 'GPS_NO_FIX',
              'lastValidLocation': null,
            },
            'geofence': null,
            'configurationAvailable': false,
          });
        case 'activity':
          return data({
            'state': 'BASELINE_LEARNING',
            'latestMeasurement': null,
            'baselineScoreMg': null,
            'history': <dynamic>[],
          });
      }
    }
    unexpectedRequests.add('${request.method} $path');
    throw StateError('Unexpected fixture request: ${request.method} $path');
  }

  Future<void> dispose(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await session.logout();
    BackendSession.replaceForTesting(_previous);
    session.api.close();
    session.dispose();
    backendTab.value = 0;
    AppLanguageController.setLanguage('en');
    AppThemeController.themeMode.value = ThemeMode.light;
    expect(
      unexpectedRequests,
      isEmpty,
      reason: 'Every API call must have an explicit fixture.',
    );
  }
}

BackendFixture useBackend(
  WidgetTester tester, {
  String role = 'PARENT',
  bool signedIn = true,
}) {
  final fixture = BackendFixture(role: role, signedIn: signedIn);
  addTearDown(() => fixture.dispose(tester));
  return fixture;
}

Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  expect(finder, findsOneWidget);
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> selectRegistrationCenter(WidgetTester tester) async {
  await tester.pumpAndSettle();
  final dropdown = find.byType(DropdownButtonFormField<String>);
  await tester.ensureVisible(dropdown);
  await tester.tap(dropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text(BackendFixture.centerName).last);
  await tester.pumpAndSettle();
}
