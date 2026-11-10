import 'package:final_project/core/app_ui.dart';

import 'brand_logo.dart';

class BrandHeader extends StatelessWidget {
  const BrandHeader({
    super.key,
    required this.title,
    required this.subtitle,
    this.height = 204,
    this.logoSize = 72,
    this.onBack,
  });

  final String title;
  final String subtitle;
  final double height;
  final double logoSize;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final topInset = MediaQuery.paddingOf(context).top;

    return Container(
      width: double.infinity,
      height: height + topInset,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF0B55A5), Color(0xFF062E72)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        clipBehavior: Clip.hardEdge,
        children: [
          Positioned(top: -78, right: -50, child: _PatternRing(size: 220)),
          Positioned(top: -45, right: -17, child: _PatternRing(size: 154)),
          Positioned(left: -92, bottom: -138, child: _PatternRing(size: 230)),
          if (onBack != null)
            Positioned(
              top: topInset + 2,
              left: 8,
              child: IconButton(
                tooltip: context.translate('Back'),
                onPressed: onBack,
                icon: const Icon(Icons.arrow_back_rounded),
                color: Colors.white,
              ),
            ),
          Positioned.fill(
            child: Padding(
              padding: EdgeInsets.fromLTRB(20, topInset + 12, 20, 16),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  BrandLogo(size: logoSize),
                  const SizedBox(height: 8),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 25,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.84),
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PatternRing extends StatelessWidget {
  const _PatternRing({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.07),
          width: 24,
        ),
      ),
    );
  }
}
