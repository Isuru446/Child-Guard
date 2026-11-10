import 'package:flutter/material.dart';

import '../app_colors.dart';

class AppAvatar extends StatelessWidget {
  final String? imageUrl;
  final double size;
  final IconData fallbackIcon;
  final Color backgroundColor;
  final Color? borderColor;
  final double borderWidth;

  const AppAvatar({
    super.key,
    this.imageUrl,
    required this.size,
    this.fallbackIcon = Icons.person_rounded,
    this.backgroundColor = const Color(0xFFE7F0FC),
    this.borderColor,
    this.borderWidth = 0,
  });

  @override
  Widget build(BuildContext context) {
    final hasBorder = borderColor != null && borderWidth > 0;
    final imageSize = size - (hasBorder ? borderWidth * 2 : 0);
    return Container(
      width: size,
      height: size,
      padding: hasBorder ? EdgeInsets.all(borderWidth) : EdgeInsets.zero,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: hasBorder ? borderColor : backgroundColor,
      ),
      child: ClipOval(
        child: imageUrl == null || imageUrl!.trim().isEmpty
            ? _fallback(imageSize)
            : Image.network(
                imageUrl!,
                width: imageSize,
                height: imageSize,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) =>
                    _fallback(imageSize),
              ),
      ),
    );
  }

  Widget _fallback(double size) => Container(
    width: size,
    height: size,
    color: backgroundColor,
    alignment: Alignment.center,
    child: Icon(fallbackIcon, color: AppColors.primaryBlue, size: size * 0.55),
  );
}
