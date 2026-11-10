import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart';
import 'wearable_location_panel.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../models/user_role.dart';
import '../main_wrapper.dart';
import '../profile/profile_screen.dart';

class MapScreen extends StatelessWidget {
  final UserRole userRole;

  const MapScreen({super.key, this.userRole = UserRole.parent});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: BackendSession.instance.signedIn
                ? SingleChildScrollView(
                    padding: EdgeInsets.fromLTRB(
                      18,
                      MediaQuery.paddingOf(context).top + 64,
                      18,
                      16,
                    ),
                    child: const WearableLocationPanel(),
                  )
                : const _MockMap(),
          ),
          Positioned(
            top: MediaQuery.paddingOf(context).top + 6,
            left: 18,
            right: 18,
            child: Row(
              children: [
                _MapIconButton(
                  icon: Icons.arrow_back_ios_new_rounded,
                  onTap: () {
                    if (!MainWrapperScreen.switchTab(context, 0)) {
                      Navigator.maybePop(context);
                    }
                  },
                ),
                Expanded(
                  child: Text(
                    BackendSession.instance.signedIn
                        ? 'Wearable Location'
                        : 'Live Location',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                _MapIconButton(
                  icon: Icons.settings_outlined,
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => ProfileScreen(userRole: userRole),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (!BackendSession.instance.signedIn)
            Positioned(
              right: 20,
              top: MediaQuery.sizeOf(context).height * 0.23,
              child: _MapIconButton(
                icon: Icons.my_location_rounded,
                onTap: () {
                  if (BackendSession.instance.signedIn) {
                    backendRefresh.value++;
                  } else {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Demo map — no wearable location.'),
                      ),
                    );
                  }
                },
              ),
            ),
          if (!BackendSession.instance.signedIn)
            Positioned(
              left: 18,
              right: 18,
              bottom: 12,
              child: _LocationDetailsCard(),
            ),
        ],
      ),
    );
  }
}

class _MapIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _MapIconButton({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: const CircleBorder(),
      elevation: 2,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: 42,
          height: 42,
          child: Icon(icon, size: 19, color: AppColors.primaryBlue),
        ),
      ),
    );
  }
}

class _LocationDetailsCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(15, 14, 15, 15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Color(0x22102748),
            blurRadius: 18,
            offset: Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              const CircleAvatar(
                radius: 23,
                backgroundColor: Color(0xFFE9F0FA),
                child: Icon(Icons.child_care, color: AppColors.primaryBlue),
              ),
              const SizedBox(width: 11),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Demo Child',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    SizedBox(height: 3),
                    Text(
                      'Room A',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.greenOnlineBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.circle, color: AppColors.greenOnline, size: 7),
                    SizedBox(width: 4),
                    Text(
                      'Demo',
                      style: TextStyle(
                        color: AppColors.greenOnline,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Divider(height: 1, color: Color(0xFFEAF0F7)),
          const SizedBox(height: 5),
          const _LocationInfoRow(
            icon: Icons.location_on_rounded,
            title: 'Demo location',
            value: 'School - Main Gate',
          ),
          const _LocationInfoRow(
            icon: Icons.access_time_rounded,
            title: 'Last Updated',
            value: '2 minutes ago',
          ),
          const _LocationInfoRow(
            icon: Icons.battery_full_rounded,
            title: 'Battery',
            value: '78%',
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: ElevatedButton.icon(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('Route to school'),
                  content: const Text(
                    'Demo Child is at the school main gate. The latest location was updated 2 minutes ago.',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Close'),
                    ),
                  ],
                ),
              ),
              icon: const Icon(Icons.alt_route_rounded, size: 18),
              label: const Text('View Route'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryBlue,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(13),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LocationInfoRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String value;

  const _LocationInfoRow({
    required this.icon,
    required this.title,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, color: AppColors.primaryBlue, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 9,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MockMap extends StatelessWidget {
  const _MockMap();

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const Positioned.fill(child: CustomPaint(painter: _MapPainter())),
        Positioned(
          left: MediaQuery.sizeOf(context).width * 0.15,
          top: MediaQuery.sizeOf(context).height * 0.22,
          child: const _MapMarker(
            icon: Icons.directions_bus_rounded,
            color: Color(0xFFF3B900),
          ),
        ),
        Positioned(
          left: MediaQuery.sizeOf(context).width * 0.49,
          top: MediaQuery.sizeOf(context).height * 0.36,
          child: const CircleAvatar(
            radius: 19,
            backgroundColor: AppColors.accentBlue,
            child: Icon(
              Icons.child_care_rounded,
              color: Colors.white,
              size: 21,
            ),
          ),
        ),
        Positioned(
          right: MediaQuery.sizeOf(context).width * 0.12,
          top: MediaQuery.sizeOf(context).height * 0.17,
          child: const _MapMarker(
            icon: Icons.school_rounded,
            color: AppColors.primaryBlue,
          ),
        ),
      ],
    );
  }
}

class _MapMarker extends StatelessWidget {
  final IconData icon;
  final Color color;

  const _MapMarker({required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: const [
          BoxShadow(
            color: Color(0x33102748),
            blurRadius: 10,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: Icon(icon, color: Colors.white, size: 20),
    );
  }
}

class _MapPainter extends CustomPainter {
  const _MapPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final background = Paint()..color = const Color(0xFFEAF4EF);
    canvas.drawRect(Offset.zero & size, background);

    final parkPaint = Paint()..color = const Color(0xFFD8EFDC);
    final blockPaint = Paint()..color = const Color(0xFFF7F8F3);
    final blockBorder = Paint()
      ..color = const Color(0xFFDDE9E2)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    final blocks = [
      Rect.fromLTWH(
        size.width * .04,
        size.height * .10,
        size.width * .24,
        size.height * .12,
      ),
      Rect.fromLTWH(
        size.width * .68,
        size.height * .04,
        size.width * .26,
        size.height * .13,
      ),
      Rect.fromLTWH(
        size.width * .06,
        size.height * .39,
        size.width * .25,
        size.height * .14,
      ),
      Rect.fromLTWH(
        size.width * .74,
        size.height * .40,
        size.width * .22,
        size.height * .15,
      ),
      Rect.fromLTWH(
        size.width * .07,
        size.height * .61,
        size.width * .18,
        size.height * .13,
      ),
      Rect.fromLTWH(
        size.width * .76,
        size.height * .63,
        size.width * .21,
        size.height * .12,
      ),
    ];
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(
          size.width * .62,
          size.height * .22,
          size.width * .25,
          size.height * .13,
        ),
        const Radius.circular(20),
      ),
      parkPaint,
    );
    for (final rect in blocks) {
      final rounded = RRect.fromRectAndRadius(rect, const Radius.circular(12));
      canvas.drawRRect(rounded, blockPaint);
      canvas.drawRRect(rounded, blockBorder);
    }

    final roadEdge = Paint()
      ..color = const Color(0xFFC8D8D1)
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 25;
    final road = Paint()
      ..color = const Color(0xFFFFFEFA)
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 20;
    final paths = [
      Path()
        ..moveTo(size.width * -.1, size.height * .31)
        ..cubicTo(
          size.width * .28,
          size.height * .28,
          size.width * .58,
          size.height * .42,
          size.width * 1.1,
          size.height * .33,
        ),
      Path()
        ..moveTo(size.width * .30, size.height * -.1)
        ..cubicTo(
          size.width * .36,
          size.height * .25,
          size.width * .25,
          size.height * .60,
          size.width * .42,
          size.height * 1.0,
        ),
      Path()
        ..moveTo(size.width * .79, size.height * -.1)
        ..cubicTo(
          size.width * .72,
          size.height * .28,
          size.width * .85,
          size.height * .62,
          size.width * .68,
          size.height * 1.1,
        ),
      Path()
        ..moveTo(size.width * -.1, size.height * .72)
        ..cubicTo(
          size.width * .32,
          size.height * .63,
          size.width * .69,
          size.height * .82,
          size.width * 1.1,
          size.height * .68,
        ),
    ];
    for (final path in paths) {
      canvas.drawPath(path, roadEdge);
      canvas.drawPath(path, road);
    }

    final route = Path()
      ..moveTo(size.width * .16, size.height * .22)
      ..lineTo(size.width * .49, size.height * .37)
      ..lineTo(size.width * .83, size.height * .18);
    final routePaint = Paint()
      ..color = AppColors.accentBlue
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4;
    canvas.drawPath(route, routePaint);
  }

  @override
  bool shouldRepaint(covariant _MapPainter oldDelegate) => false;
}
