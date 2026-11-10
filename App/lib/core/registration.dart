import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'backend.dart';

class RegistrationReceiptStore implements TokenStore {
  final String? role;
  RegistrationReceiptStore({this.role});
  final FlutterSecureStorage storage = const FlutterSecureStorage();
  String get legacyKey => 'childguard.registration.${BackendConfig.baseUrl}';
  String get key => '$legacyKey${role == null ? '' : '.$role'}';
  Future<String?> readLegacy() => storage.read(key: legacyKey);
  @override
  Future<String?> read() => storage.read(key: key);
  @override
  Future<void> write(String token) => storage.write(key: key, value: token);
  @override
  Future<void> delete() => storage.delete(key: key);
}

class RegistrationClient {
  final ApiClient api;
  final TokenStore store;
  final String? role;
  RegistrationClient({ApiClient? api, TokenStore? store, this.role})
    : api = api ?? BackendSession.instance.api,
      store = store ?? RegistrationReceiptStore(role: role);

  Future<List<Map<String, String>>> centers() async {
    final result = await api.request(
      '/api/v1/registration/centers',
      authenticated: false,
    );
    if (result is! List) {
      throw const ApiFailure('Unexpected center list response.');
    }
    final ids = <String>{};
    return result.map((row) {
      if (row is! Map ||
          row['id'] is! String ||
          row['name'] is! String ||
          (row['name'] as String).trim().isEmpty ||
          !ids.add(row['id'] as String)) {
        throw const ApiFailure('Unexpected center list response.');
      }
      return {'id': row['id'] as String, 'name': row['name'] as String};
    }).toList();
  }

  Future<bool> availability() async {
    final result = await api.request(
      '/api/v1/registration/availability',
      authenticated: false,
    );
    if (result is! Map || result['enabled'] is! bool) {
      throw const ApiFailure('Unexpected registration availability response.');
    }
    return result['enabled'] as bool;
  }

  Future<String> receipt({bool create = false}) async {
    final saved = await store.read();
    if (saved != null) return saved;
    if (!create) {
      throw const ApiFailure('No saved registration receipt on this device.');
    }
    final random = Random.secure();
    final value = List.generate(
      32,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    await store.write(value);
    return value;
  }

  Future<Map<String, dynamic>> submit(
    Map<String, dynamic> body, {
    bool resubmit = false,
  }) async {
    final code = await receipt(create: true);
    final result = await api.request(
      '/api/v1/registration${resubmit ? '/resubmit' : ''}',
      method: 'POST',
      body: body,
      authenticated: false,
      headers: {'X-Registration-Receipt': code},
    );
    return Map<String, dynamic>.from(result as Map);
  }

  Future<Map<String, dynamic>> status() async {
    var code = await store.read();
    var legacy = false;
    if (code == null && role != null && store is RegistrationReceiptStore) {
      code = await (store as RegistrationReceiptStore).readLegacy();
      legacy = code != null;
    }
    if (code == null) {
      throw const ApiFailure('No saved registration receipt on this device.');
    }
    final result = await api.request(
      '/api/v1/registration/status',
      authenticated: false,
      headers: {'X-Registration-Receipt': code},
    );
    if (result is! Map ||
        !['PENDING', 'APPROVED', 'REJECTED'].contains(result['status'])) {
      throw const ApiFailure('Unexpected registration status response.');
    }
    if (role != null && result['role'] != role) {
      throw const ApiFailure(
        'No saved registration receipt for the selected role.',
      );
    }
    if (legacy) await store.write(code);
    return Map<String, dynamic>.from(result);
  }

  Future<void> upload(
    Uint8List bytes,
    String mime, {
    bool account = false,
  }) async {
    if (bytes.length > 2 * 1024 * 1024) {
      throw const ApiFailure('Choose a photo up to 2 MB.');
    }
    final headers = <String, String>{'Content-Type': mime};
    if (account) {
      if (api.token == null) throw const ApiFailure('Sign in required.');
      headers['Authorization'] = 'Bearer ${api.token}';
    } else {
      headers['X-Registration-Receipt'] = await receipt();
    }
    final response = await api.client
        .put(
          api.base.resolve(
            account ? '/api/v1/account/photo' : '/api/v1/registration/photo',
          ),
          headers: headers,
          body: bytes,
        )
        .timeout(api.timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw const ApiFailure(
        'Photo upload failed. Registration status is preserved; retry the photo separately.',
      );
    }
    final body = jsonDecode(response.body);
    if (body is! Map || !body.containsKey('data')) {
      throw const ApiFailure('Unexpected photo response.');
    }
  }
}
