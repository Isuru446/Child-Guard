import 'dart:convert';

import 'package:http/http.dart' as http;

import 'backend_fixture.dart';

// In-memory only: never sends SMS, calls or live telemetry.
final pickupPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
);

class PickupFixture {
  static const photoId = '00000000-0000-4000-8000-000000000011';
  static const personId = '00000000-0000-4000-8000-000000000012';
  static const requestId = '00000000-0000-4000-8000-000000000013';
  final BackendFixture backend;
  late final Map<String, dynamic> person;
  final requests = <Map<String, dynamic>>[];
  bool installed = true;
  final handoverToken = 'synthetic-verified-handover-token-only-memory';
  PickupFixture(this.backend, {bool pending = true}) {
    person = {
      'id': personId,
      'childId': BackendFixture.childId,
      'fullName': 'Fixture Pickup Person',
      'address': '10 Fixture Road',
      'phone': '077 123 4567',
      'relationship': 'Grandparent',
      'photoId': photoId,
      'active': true,
    };
    if (pending) requests.add(record());
    backend.respond = respond;
  }
  Map<String, dynamic> record() => {
    'id': requestId,
    'childId': BackendFixture.childId,
    'personId': personId,
    'photoId': photoId,
    'requestedById': 'fixture-user',
    'requestedBy': {'id': 'fixture-user', 'username': 'fixture-parent'},
    'snapshot': {
      ...person,
      'childName': 'Fixture Child',
      'centerName': 'Fixture daycare',
    },
    'status': 'PENDING',
    'day': '2026-10-26',
    'windowStart': '2026-10-26T07:00:00Z',
    'windowEnd': '2026-10-26T08:00:00Z',
    'expiresAt': '2026-10-26T08:00:00Z',
    'createdAt': '2026-10-26T07:00:00Z',
    'completedAt': null,
    'reviewedBy': null,
  };
  Map<String, dynamic> issued(Map<String, dynamic> request) => {
    'request': request,
    'code': '654321',
    'message': 'ChildGuard Pickup Authorization\nFixture Child / Fixture daycare\nVerification Code: 654321\nValid until 08:00 UTC. Do not share with anyone else.',
  };
  http.Response? respond(http.Request r) {
    final path = r.url.path;
    if (path.endsWith('/parent-contacts')) {
      return BackendFixture.data(
        path.contains(BackendFixture.otherChildId)
            ? [
                {
                  'name': 'Other Child Parent',
                  'phone': null,
                  'relationship': 'Linked Parent/Guardian',
                },
              ]
            : [
                {
                  'name': 'Fixture Parent',
                  'phone': '+94 77 123 4567',
                  'relationship': 'Linked Parent/Guardian',
                },
              ],
      );
    }
    if (!path.startsWith('/api/v1/mobile/pickups')) return null;
    if (!installed) {
      return http.Response(
        jsonEncode({
          'error': {
            'code': 'PICKUP_NOT_INSTALLED',
            'message': 'Service temporarily unavailable',
          },
        }),
        503,
      );
    }
    if (path.endsWith('/photos') && r.method == 'POST') {
      return http.Response(
        jsonEncode({
          'data': {'id': photoId},
        }),
        201,
      );
    }
    if (path.endsWith('/people') && r.method == 'GET') {
      return BackendFixture.data([person]);
    }
    if (path.contains('/people') && ['POST', 'PATCH'].contains(r.method)) {
      if (path.endsWith('/deactivate')) {
        person['active'] = false;
        return BackendFixture.data(person);
      }
      person.addAll(Map<String, dynamic>.from(jsonDecode(r.body)));
      return BackendFixture.data(person);
    }
    if (path.endsWith('/requests')) {
      if (r.method == 'GET') return BackendFixture.data(requests);
      final row = record();
      requests.add(row);
      return BackendFixture.data(issued(row));
    }
    if (path.contains('/requests/')) {
      final row = requests.first;
      if (r.method == 'GET') return BackendFixture.data(row);
      if (path.endsWith('/verify')) {
        return jsonDecode(r.body)['code'] == '654321'
            ? BackendFixture.data({
                'handoverToken': handoverToken,
                'expiresAt': '2026-10-26T08:00:00Z',
              })
            : BackendFixture.error(422, 'Code not accepted');
      }
      if (path.endsWith('/regenerate')) return BackendFixture.data(issued(row));
      if (path.endsWith('/cancel')) row['status'] = 'CANCELLED';
      if (path.endsWith('/reject')) {
        row['status'] = 'REJECTED';
        row['reason'] = jsonDecode(r.body)['reason'];
      }
      if (path.endsWith('/complete')) {
        row['status'] = 'COMPLETED';
        row['completedAt'] = '2026-10-26T07:15:00Z';
        row['reviewedBy'] = {
          'id': 'fixture-user',
          'username': 'fixture-teacher',
        };
      }
      return BackendFixture.data(row);
    }
    return null;
  }
}
