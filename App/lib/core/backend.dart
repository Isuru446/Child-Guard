import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class ApiFailure implements Exception {
  final String message;
  final int? status;
  final Map<String, String> fields;
  final String? code;
  const ApiFailure(
    this.message, [
    this.status,
    this.fields = const {},
    this.code,
  ]);
  @override
  String toString() => message;
}

class BackendConfig {
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3100',
  );
  static Uri validate(String value, {bool production = kReleaseMode}) {
    final uri = Uri.parse(value);
    if (!uri.hasAuthority ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        !['http', 'https'].contains(uri.scheme) ||
        (production && uri.scheme != 'https')) {
      throw const ApiFailure(
        'Configure a valid backend URL; release requires HTTPS.',
      );
    }
    return uri;
  }
}

class ApiClient {
  final http.Client client;
  final Uri base;
  final Duration timeout;
  final bool enableStreams;
  String? token;
  Future<void> Function()? onUnauthorized;
  ApiClient({
    http.Client? client,
    String baseUrl = BackendConfig.baseUrl,
    this.timeout = const Duration(seconds: 15),
    this.enableStreams = true,
  }) : client = client ?? http.Client(),
       base = BackendConfig.validate(baseUrl);

  Future<dynamic> request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
  }) async {
    final sentToken = token;
    if (authenticated && sentToken == null) {
      throw const ApiFailure('Sign in required.', 401);
    }
    // Retry only safe reads once. Each attempt has an abortable deadline.
    for (var attempt = 0; attempt < (method == 'GET' ? 2 : 1); attempt++) {
      final abort = Completer<void>();
      try {
        final request = http.AbortableRequest(
          method,
          Uri.parse('${base.toString().replaceFirst(RegExp(r'/+$'), '')}$path'),
          abortTrigger: abort.future,
        );
        request.headers['Content-Type'] = 'application/json';
        request.headers.addAll(headers);
        if (authenticated) {
          request.headers['Authorization'] = 'Bearer $sentToken';
        }
        if (body != null) request.body = jsonEncode(body);
        final response =
            await (() async => http.Response.fromStream(
              await client.send(request),
            ))().timeout(
              timeout,
              onTimeout: () {
                if (!abort.isCompleted) abort.complete();
                throw TimeoutException('deadline');
              },
            );
        if (response.statusCode == 401 && authenticated && token == sentToken) {
          await onUnauthorized?.call();
          throw const ApiFailure(
            'Your session expired. Please sign in again.',
            401,
          );
        }
        final decoded = jsonDecode(utf8.decode(response.bodyBytes));
        if (decoded is! Map<String, dynamic>) {
          throw const ApiFailure('Unexpected backend response.');
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          final error = decoded['error'];
          if (error is Map && error['code'] == 'PICKUP_NOT_INSTALLED') {
            throw ApiFailure(
              'Pickup is not enabled yet. Your administrator must finish the approved pickup setup.',
              response.statusCode,
              const {},
              'PICKUP_NOT_INSTALLED',
            );
          }
          if (error is Map && error['code'] == 'REGISTRATION_UNAVAILABLE') {
            throw ApiFailure(
              'Self-registration is currently disabled by your administrator.',
              response.statusCode,
              const {},
              'REGISTRATION_UNAVAILABLE',
            );
          }
          if (error is Map && error['code'] == 'REGISTRATION_CONFLICT') {
            throw ApiFailure(
              'Registration details conflict with an existing application or account. Review your details or contact your center.',
              response.statusCode,
              const {},
              'REGISTRATION_CONFLICT',
            );
          }
          throw ApiFailure(
            error is Map && error['message'] is String
                ? error['message'] as String
                : 'Request failed.',
            response.statusCode,
            error is Map && error['fields'] is Map
                ? Map<String, String>.fromEntries(
                    (error['fields'] as Map).entries
                        .where(
                          (entry) =>
                              entry.key is String && entry.value is String,
                        )
                        .map(
                          (entry) => MapEntry(
                            entry.key as String,
                            entry.value as String,
                          ),
                        ),
                  )
                : const {},
            error is Map && error['code'] is String
                ? error['code'] as String
                : null,
          );
        }
        if (!decoded.containsKey('data')) {
          throw const ApiFailure('Unexpected backend response.');
        }
        if (authenticated && token != sentToken) {
          throw const ApiFailure('Session changed. Sign in again.', 401);
        }
        return decoded['data'];
      } on TimeoutException {
        if (method == 'GET' && attempt == 0) continue;
        throw const ApiFailure('Request timed out. Please try again.');
      } on http.ClientException {
        if (method == 'GET' && attempt == 0) continue;
        throw const ApiFailure(
          'Cannot reach ChildGuard. Check your connection.',
        );
      } on FormatException {
        throw const ApiFailure('Unexpected backend response.');
      }
    }
    throw const ApiFailure('Cannot reach ChildGuard.');
  }

  Future<List<Map<String, dynamic>>> all(String path) async {
    final rows = <Map<String, dynamic>>[];
    for (var offset = 0; offset <= 100000; offset += 100) {
      final page = await request(
        '$path${path.contains('?') ? '&' : '?'}limit=100&offset=$offset',
      );
      if (page is! List) throw const ApiFailure('Unexpected list response.');
      rows.addAll(page.map((e) => Map<String, dynamic>.from(e as Map)));
      if (page.length < 100) return rows;
    }
    throw const ApiFailure('Too many records; narrow the requested range.');
  }

  void close() => client.close();

  /// Foreground only. JWT stays in the header; cancellation aborts the request.
  Stream<Map<String, dynamic>> childUpdates(String childId) =>
      _updates('/api/v1/mobile/children/$childId/stream');

  Stream<Map<String, dynamic>> teacherUpdates() =>
      _updates('/api/v1/mobile/alerts/stream');

  Stream<Map<String, dynamic>> _updates(String path) async* {
    final sentToken = token;
    if (sentToken == null) throw const ApiFailure('Sign in required.', 401);
    final abort = Completer<void>();
    try {
      final request = http.AbortableRequest(
        'GET',
        Uri.parse('${base.toString().replaceFirst(RegExp(r'/+$'), '')}$path'),
        abortTrigger: abort.future,
      );
      request.headers.addAll({
        'Authorization': 'Bearer $sentToken',
        'Accept': 'text/event-stream',
      });
      final response = await client.send(request).timeout(timeout);
      if (response.statusCode == 401 && token == sentToken) {
        await onUnauthorized?.call();
        throw const ApiFailure('Sign in required.', 401);
      }
      if (response.statusCode != 200) {
        throw ApiFailure(
          'Live updates unavailable; periodic refresh remains active.',
          response.statusCode,
        );
      }
      final data = <String>[];
      await for (final line
          in response.stream
              .timeout(const Duration(seconds: 45))
              .transform(utf8.decoder)
              .transform(const LineSplitter())) {
        if (token != sentToken) return;
        if (line.isEmpty && data.isNotEmpty) {
          final event = jsonDecode(data.join('\n'));
          data.clear();
          if (event is Map<String, dynamic>) yield event;
        } else if (line.startsWith('data:')) {
          data.add(line.substring(5).trimLeft());
        }
      }
    } finally {
      if (!abort.isCompleted) abort.complete();
    }
  }
}

abstract class TokenStore {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> delete();
}

class SecureTokenStore implements TokenStore {
  final FlutterSecureStorage storage;
  SecureTokenStore({this.storage = const FlutterSecureStorage()});
  String get key => 'childguard.jwt.${BackendConfig.baseUrl}';
  @override
  Future<String?> read() => storage.read(key: key);
  @override
  Future<void> write(String token) => storage.write(key: key, value: token);
  @override
  Future<void> delete() => storage.delete(key: key);
}

class BackendSession extends ChangeNotifier {
  static BackendSession _instance = BackendSession();
  static BackendSession get instance => _instance;

  /// Allows widget tests to inject HTTP and storage without platform channels.
  @visibleForTesting
  static BackendSession replaceForTesting(BackendSession session) {
    final previous = _instance;
    _instance = session;
    return previous;
  }

  final ApiClient api;
  final TokenStore store;
  Map<String, dynamic>? user;
  bool get signedIn => user != null && api.token != null;
  bool get teacher => user?['role'] == 'TEACHER';
  BackendSession({ApiClient? api, TokenStore? store})
    : api = api ?? ApiClient(),
      store = store ?? SecureTokenStore() {
    this.api.onUnauthorized = logout;
  }
  Future<void> login(
    String username,
    String password,
    String expectedRole, {
    bool remember = true,
  }) async {
    await logout();
    final result = await api.request(
      '/api/v1/auth/login',
      method: 'POST',
      body: {'username': username, 'password': password},
      authenticated: false,
    );
    final loggedUser = Map<String, dynamic>.from(result['user'] as Map);
    if (loggedUser['role'] != expectedRole) {
      throw const ApiFailure(
        'This account does not match the selected role.',
        403,
      );
    }
    api.token = result['token'] as String;
    try {
      if (remember) await store.write(api.token!);
      user = loggedUser;
      notifyListeners();
    } catch (_) {
      api.token = null;
      throw const ApiFailure('Secure session storage is unavailable.');
    }
  }

  Future<bool> restore() async {
    try {
      api.token = await store.read();
      if (api.token == null) return false;
      final me = Map<String, dynamic>.from(
        await api.request('/api/v1/auth/me') as Map,
      );
      if (!['PARENT', 'TEACHER'].contains(me['role'])) {
        await logout();
        return false;
      }
      user = me;
      notifyListeners();
      return true;
    } catch (_) {
      await logout();
      return false;
    }
  }

  Future<void> logout() async {
    api.token = null;
    user = null;
    notifyListeners();
    try {
      await store.delete();
    } catch (_) {
      // Memory is cleared even if the platform store is temporarily unavailable.
    }
  }
}
