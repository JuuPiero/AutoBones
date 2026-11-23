"""Helpers shared by the Blender headless scripts (imported with sys.path pointing at this folder)."""
import bpy


def sanitize_materials():
    """Fix import artifacts that make models invisible.

    Some FBX files import with Principled Alpha = 0 and no alpha texture (inverted TransparencyFactor). A material that is
    100% transparent without an alpha map is never intentional, so treat it as opaque. Returns the number fixed.
    """
    fixed = 0
    for m in bpy.data.materials:
        nt = m.node_tree
        if not nt:
            continue
        for n in nt.nodes:
            if n.type != "BSDF_PRINCIPLED":
                continue
            a = n.inputs["Alpha"]
            if not a.is_linked and a.default_value < 0.01:
                a.default_value = 1.0
                for attr, val in (("blend_method", "OPAQUE"), ("surface_render_method", "DITHERED")):
                    try:
                        setattr(m, attr, val)
                    except (AttributeError, TypeError):
                        pass
                fixed += 1
    return fixed
