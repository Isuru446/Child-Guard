import 'package:flutter/material.dart' as material;

import 'app_translations.dart';

class Text extends material.Text {
  const Text(
    super.data, {
    super.key,
    super.style,
    super.strutStyle,
    super.textAlign,
    super.textDirection,
    super.locale,
    super.softWrap,
    super.overflow,
    super.textScaler,
    super.maxLines,
    super.semanticsLabel,
    super.textWidthBasis,
    super.textHeightBehavior,
    super.selectionColor,
  });

  @override
  material.Widget build(material.BuildContext context) {
    final locale = material.Localizations.localeOf(context);
    final defaultTextStyle = material.DefaultTextStyle.of(context);
    var effectiveStyle = style;
    if (style == null || style!.inherit) {
      effectiveStyle = defaultTextStyle.style.merge(style);
    }
    if (material.MediaQuery.boldTextOf(context)) {
      effectiveStyle = effectiveStyle!.merge(
        const material.TextStyle(fontWeight: material.FontWeight.bold),
      );
    }

    return material.RichText(
      key: key,
      text: material.TextSpan(
        text: AppTranslations.translate(locale, data!),
        style: effectiveStyle,
        locale: locale,
        semanticsLabel: semanticsLabel == null
            ? null
            : AppTranslations.translate(locale, semanticsLabel!),
      ),
      textAlign:
          textAlign ?? defaultTextStyle.textAlign ?? material.TextAlign.start,
      textDirection: textDirection,
      locale: locale,
      softWrap: softWrap ?? defaultTextStyle.softWrap,
      overflow:
          overflow ?? effectiveStyle?.overflow ?? defaultTextStyle.overflow,
      textScaler: textScaler ?? material.MediaQuery.textScalerOf(context),
      maxLines: maxLines ?? defaultTextStyle.maxLines,
      strutStyle: strutStyle,
      textWidthBasis: textWidthBasis ?? defaultTextStyle.textWidthBasis,
      textHeightBehavior:
          textHeightBehavior ??
          defaultTextStyle.textHeightBehavior ??
          material.DefaultTextHeightBehavior.maybeOf(context),
      selectionColor: selectionColor,
    );
  }
}
