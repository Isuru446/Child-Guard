import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/demo_pickup_code.dart';

void main() {
  test('pickup code can only be consumed once and is regenerated', () {
    final code = DemoPickupCode.generate();

    expect(code, matches(RegExp(r'^\d{6}$')));
    expect(DemoPickupCode.consume('000000'), isFalse);
    expect(DemoPickupCode.consume(code), isTrue);
    expect(DemoPickupCode.consume(code), isFalse);

    final nextCode = DemoPickupCode.generate();
    expect(nextCode, matches(RegExp(r'^\d{6}$')));
    expect(DemoPickupCode.consume(nextCode), isTrue);
  });
}
