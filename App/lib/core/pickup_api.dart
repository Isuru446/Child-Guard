import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'backend.dart';

class PickupApi {
  final ApiClient api;
  PickupApi({ApiClient? api}) : api = api ?? BackendSession.instance.api;
  static const root = '/api/v1/mobile/pickups';
  Future<dynamic> read(String path) => api.request('$root/$path');
  Future<dynamic> post(String path, [Map<String, dynamic>? body]) =>
      api.request('$root/$path', method: 'POST', body: body ?? {});
  Future<String> upload(String childId, Uint8List bytes) async {
    final sentToken = api.token;
    if (sentToken == null) throw const ApiFailure('Sign in required.', 401);
    if (bytes.length > 2 * 1024 * 1024 || bytes.length < 24) {
      throw const ApiFailure('Choose a JPEG, PNG or WebP photo up to 2 MB.');
    }
    final mime = bytes[0] == 0xff && bytes[1] == 0xd8
        ? 'image/jpeg'
        : bytes[0] == 0x89 && bytes[1] == 0x50
        ? 'image/png'
        : ascii.decode(bytes.sublist(0, 4), allowInvalid: true) == 'RIFF'
        ? 'image/webp'
        : null;
    if (mime == null) {
      throw const ApiFailure('Choose a JPEG, PNG or WebP photo.');
    }
    final abort = Completer<void>();
    try {
      final request =
          http.AbortableRequest(
              'POST',
              api.base.resolve(
                '$root/photos?childId=${Uri.encodeQueryComponent(childId)}',
              ),
              abortTrigger: abort.future,
            )
            ..headers.addAll({
              'Authorization': 'Bearer $sentToken',
              'Content-Type': mime,
            })
            ..bodyBytes = bytes;
      final response = await (() async => http.Response.fromStream(
        await api.client.send(request),
      ))().timeout(api.timeout);
      if (response.statusCode == 401) {
        if (api.token == sentToken) await api.onUnauthorized?.call();
        throw const ApiFailure('Sign in again.', 401);
      }
      final value = jsonDecode(response.body);
      if (response.statusCode != 201) {
        throw ApiFailure(
          value['error']?['message'] as String? ?? 'Photo upload failed.',
          response.statusCode,
        );
      }
      return value['data']['id'] as String;
    } on TimeoutException {
      throw const ApiFailure(
        'Photo upload timed out. Refresh before trying again.',
      );
    } finally {
      if (!abort.isCompleted) abort.complete();
    }
  }
}
