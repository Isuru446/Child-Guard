import 'package:flutter/material.dart';

class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.size = 64});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: ClipRect(
        child: Transform.scale(
          scale: 1.3,
          child: Image.asset(
            'assets/logo/child_guard_logo.png',
            fit: BoxFit.contain,
            filterQuality: FilterQuality.high,
            errorBuilder: (context, error, stackTrace) {
              return Icon(
                Icons.shield_outlined,
                color: const Color(0xFF36B7FF),
                size: size * 0.78,
              );
            },
          ),
        ),
      ),
    );
  }
}
