import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/app_colors.dart';
import '../../core/map_actions.dart';
import '../../core/widgets/backend_panels.dart';
import 'recorded_location.dart';

/// The camera is independent of periodic marker updates. Removing tile layers
/// while hidden stops inactive-tab requests; the explored camera is retained.
class StoredLocationMap extends StatefulWidget {
  final double latitude, longitude;
  final String childName;
  final bool showChild;
  final Map? zone;
  final TileProvider? tileProvider;
  const StoredLocationMap({
    super.key,
    required this.latitude,
    required this.longitude,
    required this.childName,
    this.zone,
    this.tileProvider,
    this.showChild = true,
  });
  @override
  State<StoredLocationMap> createState() => _StoredLocationMapState();
}

class _StoredLocationMapState extends State<StoredLocationMap>
    with WidgetsBindingObserver {
  final controller = MapController();
  late LatLng camera;
  double zoom = 16;
  bool foreground = true, tilesFailed = false;
  int tileRetry = 0;
  bool get visible =>
      foreground &&
      (context.getInheritedWidgetOfExactType<BackendTabScope>() == null ||
          backendTab.value == 1) &&
      (ModalRoute.of(context)?.isCurrent ?? true);
  LatLng get childPoint => LatLng(widget.latitude, widget.longitude);
  @override
  void initState() {
    super.initState();
    camera = childPoint;
    WidgetsBinding.instance.addObserver(this);
    backendTab.addListener(changed);
  }

  void changed() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(covariant StoredLocationMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!oldWidget.showChild && widget.showChild) {
      camera = childPoint;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && visible) move(childPoint, zoom);
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    changed();
  }

  @override
  void dispose() {
    backendTab.removeListener(changed);
    WidgetsBinding.instance.removeObserver(this);
    controller.dispose();
    super.dispose();
  }

  void move(LatLng point, double targetZoom) {
    controller.move(point, targetZoom.clamp(3, 19).toDouble());
  }

  @override
  Widget build(BuildContext context) {
    final zone = validVisualZone(widget.zone);
    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: SizedBox(
        height: 340,
        child: !visible
            ? const ColoredBox(color: Color(0xFFEAF4EF))
            : Stack(
                children: [
                  FlutterMap(
                    mapController: controller,
                    options: MapOptions(
                      initialCenter: camera,
                      initialZoom: zoom,
                      minZoom: 3,
                      maxZoom: 19,
                      interactionOptions: const InteractionOptions(
                        flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
                      ),
                      onPositionChanged: (position, hasGesture) {
                        camera = position.center;
                        zoom = position.zoom;
                      },
                    ),
                    children: [
                      _CachedTiles(
                        key: ValueKey(tileRetry),
                        tileProvider: widget.tileProvider,
                        onError: () {
                          if (!tilesFailed) {
                            WidgetsBinding.instance.addPostFrameCallback((_) {
                              if (mounted) setState(() => tilesFailed = true);
                            });
                          }
                        },
                      ),
                      if (zone != null)
                        CircleLayer(
                          circles: [
                            CircleMarker(
                              point: LatLng(
                                (zone['latitude'] as num).toDouble(),
                                (zone['longitude'] as num).toDouble(),
                              ),
                              radius: (zone['radiusM'] as num).toDouble(),
                              useRadiusInMeter: true,
                              color: AppColors.accentBlue.withValues(
                                alpha: 0.15,
                              ),
                              borderColor: AppColors.accentBlue,
                              borderStrokeWidth: 2,
                            ),
                          ],
                        ),
                      MarkerLayer(
                        markers: [
                          if (zone != null)
                            Marker(
                              point: LatLng(
                                (zone['latitude'] as num).toDouble(),
                                (zone['longitude'] as num).toDouble(),
                              ),
                              width: 24,
                              height: 24,
                              child: Tooltip(
                                message: 'Configured safe-zone center',
                                child: Icon(
                                  Icons.circle_outlined,
                                  color: AppColors.accentBlue,
                                  size: 18,
                                ),
                              ),
                            ),
                          if (widget.showChild)
                            Marker(
                              point: childPoint,
                              width: 44,
                              height: 44,
                              alignment: Alignment.topCenter,
                              child: Tooltip(
                                message:
                                    '${widget.childName} — recorded location',
                                child: const Icon(
                                  Icons.location_on_rounded,
                                  size: 42,
                                  color: AppColors.primaryBlue,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                  Positioned(
                    top: 8,
                    right: 8,
                    child: Column(
                      children: [
                        _control(
                          'Zoom in',
                          Icons.add,
                          () => move(
                            controller.camera.center,
                            controller.camera.zoom + 1,
                          ),
                        ),
                        const SizedBox(height: 6),
                        _control(
                          'Zoom out',
                          Icons.remove,
                          () => move(
                            controller.camera.center,
                            controller.camera.zoom - 1,
                          ),
                        ),
                        const SizedBox(height: 6),
                        _control(
                          widget.showChild
                              ? 'Recenter to child'
                              : 'Recenter safe area',
                          Icons.my_location,
                          () => move(childPoint, zoom),
                        ),
                      ],
                    ),
                  ),
                  if (tilesFailed)
                    Positioned(
                      left: 6,
                      top: 6,
                      right: 60,
                      child: Material(
                        color: Colors.white.withValues(alpha: 0.95),
                        borderRadius: BorderRadius.circular(8),
                        child: Padding(
                          padding: EdgeInsets.all(6),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Text(
                                'Some map tiles are unavailable. Recorded coordinates remain above.',
                                style: TextStyle(fontSize: 11),
                              ),
                              TextButton(
                                onPressed: () => setState(() {
                                  tilesFailed = false;
                                  tileRetry++;
                                }),
                                child: const Text('Retry tiles'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  Positioned(
                    bottom: 4,
                    left: 4,
                    right: 4,
                    child: Align(
                      alignment: Alignment.bottomRight,
                      child: ColoredBox(
                        color: Colors.white,
                        child: InkWell(
                          onTap: MapActions.attribution,
                          child: const Padding(
                            padding: EdgeInsets.all(4),
                            child: Text(
                              '© OpenStreetMap contributors',
                              style: TextStyle(
                                fontSize: 11,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _control(String tooltip, IconData icon, VoidCallback action) =>
      Material(
        color: Colors.white,
        shape: const CircleBorder(),
        elevation: 2,
        child: IconButton(
          tooltip: tooltip,
          onPressed: action,
          icon: Icon(icon, color: AppColors.primaryBlue),
        ),
      );
}

// Own one provider for the lifetime of the visible TileLayer; don't create an
// HTTP client on every backend refresh. TileLayer disposes it on removal.
class _CachedTiles extends StatefulWidget {
  final TileProvider? tileProvider;
  final VoidCallback onError;
  const _CachedTiles({super.key, this.tileProvider, required this.onError});
  @override
  State<_CachedTiles> createState() => _CachedTilesState();
}

class _CachedTilesState extends State<_CachedTiles> {
  late final TileProvider provider =
      widget.tileProvider ??
      NetworkTileProvider(
        cachingProvider: BuiltInMapCachingProvider.getOrCreateInstance(
          maxCacheSize: 100000000,
        ),
      );
  @override
  Widget build(BuildContext context) => TileLayer(
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    userAgentPackageName:
        'ChildGuardV2UniversityPrototype/1.0 (com.example.final_project)',
    maxNativeZoom: 19,
    panBuffer: 0,
    keepBuffer: 1,
    tileProvider: provider,
    errorTileCallback: (tile, error, stack) => widget.onError(),
  );
}
