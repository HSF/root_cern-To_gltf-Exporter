/**
 * javascript code to export a ROOT geometry to GLTF
 *
 * Main supported features :
 *   - able to cleanup the geometry by dropping all subtrees of a given list
 *   - able to split the geometry into pieces and match them to the hierarchical menu in phoenix
 *   - supports default opacity and visibility for each piece
 *   - simplifies the geometry for spheres and cones to avoid too many faces
 *   - deduplicate materials in the resulting gltf file
 */
import { Scene } from "three"
import { GLTFExporter } from "gltfexporter"
import { openFile, geoCfg } from "root"
import { build } from "rootgeom"

/// checks whether a name matches one of the given paths
function matches(name, paths) {
    for (const path of paths) {
        if (typeof(path) == "string") {
            if (name.startsWith(path)) {
                return true;
            }
        } else { // needs to be a regexp
            if (name.match(path)) {
                return true;
            }
        }
    }
    return false;
}

/// filters an array in place
function filterArrayInPlace(a, condition, thisArg) {
    var j = 0;
    a.forEach((e, i) => { 
        if (condition.call(thisArg, e, i, a)) {
            if (i!==j) a[j] = e; 
            j++;
        }
    });
    a.length = j;
    return a;
}

/**
 * cleans up the geometry in node by dropping all subtress whose path starts with
 * one of the hidden_paths and all nodes byond a given level
 */
function cleanup_geometry(node, hidden_paths, max_level, fullPath, level = 0, path='_') {
    if (node.fVolume.fNodes) {
        path = path + node.fVolume.fName + '_'
        // drop hidden nodes, and everything after level max_level
        filterArrayInPlace(node.fVolume.fNodes.arr, n=>level<max_level&&!matches((fullPath?path:'')+n.fName, hidden_paths));
        // recurse to children
        if (node.fVolume.fNodes.arr.length > 0) {
            for (const snode of node.fVolume.fNodes.arr) {
                cleanup_geometry(snode, hidden_paths, max_level, fullPath, level + 1, path);
            }
        }
    }
}

function forceDisplay() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/// deduplicates identical materials in the given gltf file
async function deduplicate(gltf, body) {
    // deduplicate materials
    body.innerHTML += "<h3>Materials</h3>"
    await forceDisplay()
    // scan them, build table of correspondance
    var kept = []
    var links = {}
    var materials = gltf["materials"];
    body.innerHTML += "initial number of materials : " + materials.length + "</br>"
    await forceDisplay()
    for (var index = 0; index < materials.length; index++) {
        var found = false;
        for (var kindex = 0; kindex < kept.length; kindex++) {
            if (JSON.stringify(kept[kindex]) == JSON.stringify(materials[index])) {
                links[index] = kindex;
                found = true;
                break;
            }
        }
        if (!found) {
            links[index] = kept.length;
            kept.push(materials[index]);
        }
    }
    // now rewrite the materials table and fix the meshes
    gltf["materials"] = kept;
    for (const mesh of gltf["meshes"]) {
        for(const primitive of mesh["primitives"]) {
            if ("material" in primitive) {
                primitive["material"] = links[primitive["material"]];
            }
        }
    }
    body.innerHTML += "new number of materials : " + gltf["materials"].length + "</br>"
    // deduplicate meshes
    body.innerHTML += "<h3>Meshes</h3>"
    body.innerHTML += "initial number of meshes/accessors : " + gltf.meshes.length + "/" + gltf.accessors.length + "</br>"
    await forceDisplay()
    kept = []
    links = {}
    for (var index = 0; index < gltf.meshes.length; index++) {
        var found = false;
        for (var kindex = 0; kindex < kept.length; kindex++) {
            if (JSON.stringify(kept[kindex]) == JSON.stringify(gltf.meshes[index])) {
                links[index] = kindex;
                found = true;
                break;
            }
        }
        if (!found) {
            links[index] = kept.length;
            kept.push(gltf.meshes[index]);
        }
    }
    // now rewrite the meshes table and fix the nodes
    gltf.meshes = kept;
    body.innerHTML += "new number of meshes/accessors : " + gltf.meshes.length + "/" + gltf.accessors.length + "</br>"
    await forceDisplay()

    let json = JSON.stringify(gltf)
    json = json.replace(/"mesh":([0-9]+)/g, function(a,b) {
        return `"mesh":${links[parseInt(b)]}`
    })
    return JSON.parse(json)
}

/// convert given geometry to GLTF
async function convert_geometry(obj3d, name, body) {
    body.innerHTML += "<h2>Exporting to GLTF</h2>"
    await forceDisplay()
    const exporter = new GLTFExporter();
    let gltf = await new Promise((resolve, reject) =>
        exporter.parse(obj3d, resolve, reject, {'binary':false})
    )
    // json output
    body.innerHTML += "<h2>Deduplicating data in GLTF</h2>"    
    await forceDisplay()
    gltf = await deduplicate(gltf, body);
    const fileToSave = new Blob([JSON.stringify(gltf)], {
        type: 'application/json',
        name: name
    });
    saveAs(fileToSave, name);
}

var kVisThis = 0x80;
var kVisDaughter = 0x8;

// goes recursively through shape and sets the number of segments for spheres
function fixSphereShapes(shape) {
    // in case of sphere, do the fix
    if (shape._typename == "TGeoSphere") {
        shape.fNseg = 3;
        shape.fNz = 3;
    }
    // in case of composite shape, recurse
    if (shape._typename == "TGeoCompositeShape") {
        fixSphereShapes(shape.fNode.fLeft)
        fixSphereShapes(shape.fNode.fRight)
    }
}

// makes given node visible
function setVisible(node) {
    node.fVolume.fGeoAtt = (node.fVolume.fGeoAtt | kVisThis);
}
// makes given node's daughters visible
function setVisibleDaughter(node) {
    node.fVolume.fGeoAtt = (node.fVolume.fGeoAtt | kVisDaughter);
}
// makes given node invisible
function setInvisible(node) {
    node.fVolume.fGeoAtt = (node.fVolume.fGeoAtt & ~kVisThis);
}
// makes given node and all its children recursively visible
function set_visible_recursively(node) {
    if (node.fVolume.fFillStyle != 0) {
        setVisible(node);
    }
    // Change the number of faces for sphere so that we avoid having
    // megabytes for the Rich mirrors, which are actually almost flat
    // Default was 20 and 11
    fixSphereShapes(node.fVolume.fShape)
    if (node.fVolume.fNodes) {
        for (var snode of node.fVolume.fNodes.arr) {
            set_visible_recursively(snode);
        }
    }
}
// makes given node and all its children recursively invisible
function set_invisible_recursively(node) {
    setInvisible(node);
    if (node.fVolume.fNodes) {
        for (var snode of node.fVolume.fNodes.arr) {
            set_invisible_recursively(snode);
        }
    }
}

/**
 * make only the given paths visible in a geometry and returns
 * whether anything at all is visible
 */
function keep_only_subpart(node, paths, fullPath, path='_') {
    if (!node.fVolume) return false;
    var volume = node.fVolume;
    if (!volume.fNodes) return false;
    // mimic here the way root to gltf conversion works :
    // Top node uses master volume name, other use node name
    var name = (path=='_'?node.fVolume.fName:node.fName);
    path = path + name +'_';
    var anyfound = false;
    for (var snode of volume.fNodes.arr) {
        if (matches((fullPath?path:'')+snode.fName, paths)) {
            // need to be recursive in case something deeper was hidden in previous round
            set_visible_recursively(snode);
            anyfound=true;
        } else {
            // make daughers visible if a subpart is shown
            var subpartfound = keep_only_subpart(snode, paths, fullPath, path);
            if (subpartfound) {
                setVisibleDaughter(snode);
                anyfound = true;
            }
        }
    }
    return anyfound;
}

/**
 * Counts the number of objects in a hierarchy
 */
function countGLTFObjects(node) {
    var n = node.children.length;
    for (var child of node.children) {
        n += countGLTFObjects(child);
    }
    return n;
}

/**
 * Counts the number of objects in a hierarchy
 */
function countRootObjects(volume) {
    var n = volume.fNodes.arr.length;
    for (var child of volume.fNodes.arr) {
        if (child.fVolume.fNodes) {
            n += countRootObjects(child.fVolume);
        }
    }
    return n;
}

/**
 * Removes children nodes that are not matching paths
 * these should never have been created, but jsRoot has limitations and may create
 * unwanted children in cases where the same logical volume is shared by several physical
 * volumes out of which some should be visible and others not.
 * Root is never checking the flags of the physical volumes, only of the logical one,
 * creating this situation
 */
function cleanupChildren(child, paths, fullPath, path='_') {
    // check all children and call ourselves recursively when we keep one
    filterArrayInPlace(child.children,
                       n=>n.name=='' ||
                       matches((fullPath?path:'')+n.name+'_', paths) ||
                       cleanupChildren(n, paths, fullPath, path+n.name+'_'));
    return child.children.length > 0;
}

/**
 * Convert a given geometry to the gltf file
 * @parameter obj the input geometry
 * @parameter filename the name of the resulting file
 * @parameter max_level maximum depth to convert. Anything below will be discarded
 * @parameter hide_children array of paths prefix for nodes that should be ignored
 * @parameter subparts definition of the subparts to create in the geometry
 * @parameter body the body tag of the page, for writing log to it
 * @parameter nFaces number of faces to be used for spheres
 * @parameter fullPath whether to compare subparts and hide_children with full path or only names
 * 
 * subparts is a dictionnary with
 *   - key being the path of the subpart in the phoenix menu, with ' > ' as separator
 *     for the different levels, e.g. "a > b > c" will be entry c in submenu b of menu a
 *   - value being an array of 2 items :
 *      + an array of paths to consider for thea part
 *      + a boolean or a float between 0 and 1 defining the default visibility of the part
 *        false means not visible, true means visible, float means visible with that opacity
 */
async function internal_convert_geometry(obj, filename, max_level, subparts, hide_children, body, nFaces, fullPath) {
    const scenes = [];
    // for each geometry subpart, duplicate the geometry and keep only the subpart
    body.innerHTML += "<h2>Generating all scenes (one per subpart)</h2>"
    // drop nodes we do not want to see at all (usually too detailed parts)
    cleanup_geometry(obj.fNodes.arr[0], hide_children, max_level, fullPath);
    body.innerHTML += "  initial Root file has " + countRootObjects(obj) + " objects (after cleanup)</br>"
    await forceDisplay()

    for (const [name, entry] of Object.entries(subparts)) {
        // dump to gltf, using one scene per subpart
        // set nb of degrees per face for circles approximation to nFaces
        geoCfg('GradPerSegm', 360/nFaces);
        const paths = entry[0];
        const visibility = entry[1];
        // extract subpart of ROOT geometry
        var masterNode = obj.fNodes.arr[0];
        // first reset visibility to be sure eveything is invisible
        set_invisible_recursively(masterNode)
        // make top node visible
        setVisible(masterNode);
        keep_only_subpart(masterNode, paths, fullPath);
        // convert to gltf
        var scene = new Scene();
        scene.name = name;
        var children = build(obj, {dflt_colors: true, vislevel:10, numfaces: 10000000, numnodes: 500000});
        // remove from children paths that should not be there
        cleanupChildren(children, paths, fullPath)
        scene.children.push( children );
        if (typeof visibility == "boolean") {
            scene.userData = {"visible" : visibility};
        } else {
            scene.userData = {"visible" : true, "opacity" : visibility};
        }
        body.innerHTML += "  " + name + " -> " + countGLTFObjects(children) + " objects</br>"
        await forceDisplay()
        scenes.push(scene);
    }
    body.innerHTML += '</br>' + scenes.length + ' scenes generated</br>';
    await forceDisplay()
    await convert_geometry(scenes, filename, body);
}

async function convertGeometry(inputFile, outputFile, max_level, subparts, hide_children, fullPath=false, objectName = "Default", nFaces = 24) {
    const body = document.body
    body.innerHTML = "<h1>Converting ROOT geometry to GLTF</h1>Input file : " + inputFile + "</br>Output file : " + outputFile + "</br>Reading input..." 
    const file = await openFile(inputFile)
    const obj = await file.readObject(objectName + ";1")
    await internal_convert_geometry(obj, outputFile, max_level, subparts, hide_children, body, nFaces, fullPath)
    body.innerHTML += "<h1>Convertion succeeded !</h1>"
}

export {convertGeometry};
